import { createClient } from "jsr:@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";

async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not set");
    return false;
  }

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (!timestamp || !signature) {
    console.error("Missing Slack headers", { timestamp, signature });
    return false;
  }

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    console.error("Request too old");
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const computed = "v0=" + Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const valid = computed === signature;
  if (!valid) console.error("Slack signature mismatch");
  return valid;
}

// Parse optional [slug] prefix and optional DECISION: keyword from raw text
// Returns { slug, isDecision, rationale, cleanText }
function parseMessage(raw: string): {
  slug: string | null;
  isDecision: boolean;
  rationale: string | null;
  cleanText: string;
} {
  let text = raw.trim();
  let slug: string | null = null;
  let isDecision = false;
  let rationale: string | null = null;

  // Extract [slug] prefix
  const slugMatch = text.match(/^\[([^\]]+)\]\s*/);
  if (slugMatch) {
    slug = slugMatch[1].toLowerCase().trim();
    text = text.slice(slugMatch[0].length).trim();
  }

  // Extract DECISION: keyword
  // Format: DECISION: summary -- rationale
  const decisionMatch = text.match(/^DECISION:\s*(.+?)(?:\s+--\s+(.+))?$/is);
  if (decisionMatch) {
    isDecision = true;
    text = decisionMatch[1].trim();
    rationale = decisionMatch[2]?.trim() ?? null;
  }

  return { slug, isDecision, rationale, cleanText: text };
}

Deno.serve(async (req: Request) => {
  try {
    console.log("Invoked:", req.method, req.url);
    const rawBody = await req.text();
    console.log("Received Slack event, body length:", rawBody.length);

    const verified = await verifySlackSignature(req, rawBody);
    if (!verified) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.type === "url_verification") {
      console.log("URL verification challenge");
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const event = body.event;
    if (!event || event.type !== "message" || event.subtype) {
      console.log("Skipping event", event?.type, event?.subtype);
      return new Response("ok", { status: 200 });
    }

    const rawText: string = event.text?.trim();
    if (!rawText) return new Response("ok", { status: 200 });

    const threadId: string = event.thread_ts ?? event.ts;
    const eventId: string = body.event_id;
    console.log("Processing event_id:", eventId, "text length:", rawText.length);

    // Respond to Slack immediately to prevent retries (Slack requires <3s response)
    const responsePromise = new Promise<void>((resolve) => {
      EdgeRuntime.waitUntil(processMessage(rawText, threadId, eventId));
      resolve();
    });
    await responsePromise;
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("Internal error", { status: 500 });
  }
});

async function processMessage(rawText: string, threadId: string, eventId: string) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Deduplicate: skip if this event_id was already processed
    if (eventId) {
      const { data: existing } = await supabase
        .from("thoughts")
        .select("id")
        .eq("slack_event_id", eventId)
        .maybeSingle();
      if (existing) {
        console.log("Duplicate event, skipping:", eventId);
        return;
      }
    }

    const { slug, isDecision, rationale, cleanText } = parseMessage(rawText);

    // Resolve project_id from slug if provided
    let projectId: string | null = null;
    if (slug) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (project) {
        projectId = project.id;
        console.log("Linked to project:", slug, projectId);
      } else {
        console.warn("Unknown project slug:", slug);
      }
    }

    // Route decisions to project_decisions table
    if (isDecision && projectId) {
      const { error } = await supabase.from("project_decisions").insert({
        project_id: projectId,
        summary: cleanText,
        rationale,
        source: "slack",
      });
      if (error) {
        console.error("Decision insert error:", error);
      } else {
        console.log("Decision logged for project:", slug);
      }
      return;
    }

    // 1. Classify with Claude haiku
    console.log("Calling Claude...");
    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `Classify this thought and extract metadata. Return ONLY valid JSON with these fields:
- category: one of "people", "projects", "ideas", "admin", "needs_review"
- confidence: float 0-1
- title: short descriptive title (max 8 words)
- next_action: concrete next step if applicable, else null
- people: array of person names mentioned, else []
- topics: array of 1-3 topic tags, else []

Thought: """${cleanText}"""`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      console.error("Claude error:", await claudeRes.text());
      return;
    }

    const claudeData = await claudeRes.json();
    console.log("Claude classification complete");

    let metadata: {
      category: string;
      confidence: number;
      title: string;
      next_action: string | null;
      people: string[];
      topics: string[];
    };

    try {
      const raw = claudeData.content[0].text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      metadata = JSON.parse(raw);
    } catch {
      console.error("Failed to parse Claude response:", claudeData.content[0].text);
      return;
    }

    // 2. Embed with OpenAI
    console.log("Calling OpenAI...");
    const openaiRes = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: cleanText,
      }),
    });

    if (!openaiRes.ok) {
      console.error("OpenAI error:", await openaiRes.text());
      return;
    }

    const openaiData = await openaiRes.json();
    const embedding: number[] = openaiData.data[0].embedding;
    console.log("Embedding length:", embedding.length);

    // 3. Insert into Supabase
    console.log("Inserting into DB...");
    const { error } = await supabase.from("thoughts").insert({
      raw_text: cleanText,
      source: "slack",
      thread_id: threadId,
      slack_event_id: eventId ?? null,
      project_id: projectId,
      category: metadata.category,
      confidence: metadata.confidence,
      title: metadata.title,
      next_action: metadata.next_action,
      people: metadata.people,
      topics: metadata.topics,
      embedding: `[${embedding.join(",")}]`,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return;
    }

    console.log("Success!");
  } catch (err) {
    console.error("Unhandled error in processMessage:", err);
  }
}
