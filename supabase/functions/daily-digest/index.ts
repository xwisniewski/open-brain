import { createClient } from "jsr:@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const SLACK_API_URL = "https://slack.com/api";

// ---------------------------------------------------------------------------
// Slack signing secret verification (HMAC-SHA256)
// ---------------------------------------------------------------------------
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET")!;
  const baseString = `v0:${timestamp}:${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const hex = "v0=" +
    Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

// ---------------------------------------------------------------------------
// Google OAuth + Calendar + Gmail helpers
// ---------------------------------------------------------------------------
async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function getCalendarEvents(accessToken: string): Promise<string> {
  const userTZ = "America/Los_Angeles";

  // Compute today's date string in user's timezone
  const todayDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: userTZ }).format(new Date());
  const dayAfterDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: userTZ })
    .format(new Date(Date.now() + 2 * 86400000));

  // Get the current UTC offset for the user's timezone (handles DST automatically)
  const tzOffsetStr = (() => {
    const now = new Date();
    const utcMs = Date.parse(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const localMs = Date.parse(now.toLocaleString("en-US", { timeZone: userTZ }));
    const diffMin = (localMs - utcMs) / 60000;
    const sign = diffMin >= 0 ? "+" : "-";
    const abs = Math.abs(diffMin);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  })();

  const params = new URLSearchParams({
    timeMin: `${todayDateStr}T00:00:00${tzOffsetStr}`,
    timeMax: `${dayAfterDateStr}T00:00:00${tzOffsetStr}`,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) { console.error("Calendar API error:", await res.text()); return ""; }

  const data = await res.json();
  const events: Array<{ summary?: string; start?: { dateTime?: string; date?: string } }> =
    data.items ?? [];
  if (events.length === 0) return "";

  // Group events by day label so Claude knows today vs tomorrow
  const tomorrowDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: userTZ })
    .format(new Date(Date.now() + 86400000));

  const byDay: Record<string, string[]> = { [todayDateStr]: [], [tomorrowDateStr]: [] };
  for (const e of events) {
    const title = e.summary ?? "(no title)";
    const start = e.start?.dateTime ?? e.start?.date ?? "";
    const dayKey = start.includes("T")
      ? new Intl.DateTimeFormat("en-CA", { timeZone: userTZ }).format(new Date(start))
      : start.slice(0, 10);
    const timeLabel = start.includes("T")
      ? new Date(start).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: userTZ,
        })
      : "all-day";
    if (byDay[dayKey] !== undefined) byDay[dayKey].push(`- ${title} (${timeLabel})`);
  }

  const sections: string[] = [];
  if (byDay[todayDateStr].length > 0) {
    sections.push(`*Today*\n${byDay[todayDateStr].join("\n")}`);
  }
  if (byDay[tomorrowDateStr].length > 0) {
    sections.push(`*Tomorrow*\n${byDay[tomorrowDateStr].join("\n")}`);
  }
  if (sections.length === 0) return "";
  return sections.join("\n\n");
}

async function getGmailMessages(accessToken: string): Promise<string> {
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=is%3Aunread+OR+is%3Astarred&maxResults=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) { console.error("Gmail list error:", await listRes.text()); return ""; }

  const listData = await listRes.json();
  const messages: Array<{ id: string }> = listData.messages ?? [];
  if (messages.length === 0) return "";

  const details = await Promise.all(
    messages.map(async (msg) => {
      const res = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      const d = await res.json();
      const headers: Array<{ name: string; value: string }> = d.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "unknown";
      const snippet: string = (d.snippet ?? "").slice(0, 100);
      return `- From: ${from}\n  Subject: ${subject}\n  Preview: ${snippet}`;
    }),
  );

  const valid = details.filter(Boolean) as string[];
  if (valid.length === 0) return "";
  return `Top unread/starred emails:\n${valid.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Core digest logic — extracted so it can run in the background
// ---------------------------------------------------------------------------
async function runDigest(): Promise<Response> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Fetch thoughts from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: thoughts, error } = await supabase
    .from("thoughts")
    .select("raw_text, title, category, topics, next_action, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("DB error:", error);
    return new Response("DB error", { status: 500 });
  }

  if (!thoughts || thoughts.length === 0) {
    console.log("No thoughts in the last 24 hours, skipping digest");
    return new Response("No thoughts today", { status: 200 });
  }

  // 2. Fetch Google Calendar + Gmail data (non-fatal — digest still sends if Google is unavailable)
  let calendarSection = "";
  let gmailSection = "";
  try {
    const accessToken = await getGoogleAccessToken();
    [calendarSection, gmailSection] = await Promise.all([
      getCalendarEvents(accessToken),
      getGmailMessages(accessToken),
    ]);
  } catch (googleErr) {
    console.error("Google API error (non-fatal):", googleErr);
  }

  // 2a. Run pattern detection queries in parallel (pure SQL, zero AI cost)
  let patternLines: string[] = [];
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [suggestedProjects, recurringActions, staleActions, recurringPeople] =
      await Promise.all([
        // Suggested projects: topics from unlinked thoughts appearing 3+ times in 7 days
        supabase.rpc("detect_suggested_projects", { since: sevenDaysAgo }),
        // Recurring actions: same next_action text 2+ times in 7 days
        supabase.rpc("detect_recurring_actions", { since: sevenDaysAgo }),
        // Stale actions: next_action thoughts older than 7 days, not older than 30
        supabase.rpc("detect_stale_actions", {
          older_than: sevenDaysAgo,
          newer_than: thirtyDaysAgo,
        }),
        // Recurring people: people mentioned 3+ times in 7 days
        supabase.rpc("detect_recurring_people", { since: sevenDaysAgo }),
      ]);

    // 2b. Write novel insights to DB and collect display lines
    const insightRows: Array<{ type: string; title: string; detail: Record<string, unknown> }> = [];

    for (const row of (suggestedProjects.data ?? [])) {
      insightRows.push({
        type: "suggested_project",
        title: row.topic,
        detail: { count: row.count, thought_ids: row.thought_ids },
      });
    }
    for (const row of (recurringActions.data ?? [])) {
      insightRows.push({
        type: "recurring_action",
        title: row.action,
        detail: { count: row.count, thought_ids: row.thought_ids },
      });
    }
    // Sort stale actions newest-first (fewest days old) so recent real items surface above old test artifacts
    const sortedStale = [...(staleActions.data ?? [])].sort((a, b) => a.days_old - b.days_old);
    for (const row of sortedStale) {
      insightRows.push({
        type: "stale_action",
        title: row.action,
        detail: { days_old: row.days_old, thought_id: row.thought_id },
      });
    }
    for (const row of (recurringPeople.data ?? [])) {
      insightRows.push({
        type: "recurring_person",
        title: row.person,
        detail: { count: row.count, thought_ids: row.thought_ids },
      });
    }

    // Deduplicate against existing insights and insert new ones
    // Track per-type display counts to cap the Slack block
    const displayCaps: Record<string, number> = {
      suggested_project: 1,
      recurring_action: 2,
      stale_action: 2,
      recurring_person: 2,
    };
    const displayCounts: Record<string, number> = {};

    // Helper: truncate long text for display
    const truncate = (text: string, max = 70) =>
      text.length > max ? text.slice(0, max).trimEnd() + "…" : text;

    for (const insight of insightRows) {
      const { data: exists } = await supabase.rpc("insight_exists", {
        p_type: insight.type,
        p_title: insight.title,
      });
      if (!exists) {
        await supabase.from("insights").insert(insight);
      }

      // Skip single-word suggested project topics — too generic to be useful
      if (insight.type === "suggested_project" && !insight.title.includes(" ")) continue;

      // Build display line (cap per type regardless of novelty)
      displayCounts[insight.type] = (displayCounts[insight.type] ?? 0) + 1;
      if (displayCounts[insight.type] > displayCaps[insight.type]) continue;

      let line = "";
      if (insight.type === "suggested_project") {
        line = `• Potential project: _${insight.title}_ (${(insight.detail as { count: number }).count}x this week)`;
      } else if (insight.type === "recurring_action") {
        line = `• Recurring: "${truncate(insight.title)}" (${(insight.detail as { count: number }).count}x)`;
      } else if (insight.type === "stale_action") {
        line = `• Stale: "${truncate(insight.title)}" — ${(insight.detail as { days_old: number }).days_old}d old`;
      } else if (insight.type === "recurring_person") {
        line = `• Frequent: _${insight.title}_ (${(insight.detail as { count: number }).count}x)`;
      }
      if (line) patternLines.push(line);
    }
  } catch (patternErr) {
    console.error("Pattern detection error (non-fatal):", patternErr);
    patternLines = [];
  }

  // 2c. Build pattern section for Claude prompt (compact, no headers)
  const patternSection = patternLines.length > 0
    ? `\n\n## Patterns detected this week\n${patternLines.join("\n")}\nBriefly mention the most significant pattern in one sentence.`
    : "";

  // 2. Format thoughts for Claude
  const thoughtsList = thoughts.map((t) =>
    `- [${t.category}] ${t.title}: "${t.raw_text}"${t.next_action ? ` → Next: ${t.next_action}` : ""}${
      t.topics?.length ? ` (${t.topics.join(", ")})` : ""
    }`
  ).join("\n");

  // 3. Generate digest with Claude Sonnet
  const claudeRes = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            `You are a personal assistant summarizing someone's second brain capture for the day.

Here are the thoughts captured in the last 24 hours:
${thoughtsList}
${gmailSection ? `\nUnread/starred emails:\n${gmailSection}\n` : ""}
Write 2-3 sentences max focused on what's most actionable today from the captured thoughts. If there is an urgent or important email, mention it briefly. Do not mention calendar events — those are shown separately. Do not summarize patterns — those are shown separately. Plain prose only, no markdown headers or bullet points.`,
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    console.error("Claude error:", await claudeRes.text());
    return new Response("Claude error", { status: 500 });
  }

  const claudeData = await claudeRes.json();
  const digest = claudeData.content[0].text;
  const count = thoughts.length;

  // 2d. Build Slack Block Kit message
  const userTZ = "America/Los_Angeles";
  const dayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: userTZ,
  });

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🧠 Second Brain Digest", emoji: true },
    },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${dayStr} · ${count} thought${count !== 1 ? "s" : ""} captured in the last 24 hours`,
      }],
    },
  ];

  if (calendarSection) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📅 *Schedule*\n${calendarSection}` },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: digest },
  });

  if (patternLines.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `🔍 *Patterns this week*\n${patternLines.join("\n")}` },
    });
  }

  const fallbackText = `🧠 Second Brain Digest — ${dayStr}\n\n${digest}`;

  // 4. Open DM channel with user
  const dmRes = await fetch(`${SLACK_API_URL}/conversations.open`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: Deno.env.get("SLACK_USER_ID") }),
  });

  const dmData = await dmRes.json();
  if (!dmData.ok) {
    console.error("Slack DM open error:", dmData.error);
    return new Response("Slack DM error", { status: 500 });
  }

  // 5. Post digest to DM
  const postRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: dmData.channel.id,
      text: fallbackText,
      blocks: blocks,
    }),
  });

  const postData = await postRes.json();
  if (!postData.ok) {
    console.error("Slack post error:", postData.error);
    return new Response("Slack post error", { status: 500 });
  }

  console.log(`Digest sent: ${count} thoughts, ${patternLines.length} new insights`);
  return new Response("ok", { status: 200 });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const contentType = req.headers.get("content-type") ?? "";

  // Detect Slack slash command: Content-Type is application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    // Read raw body first (needed for HMAC verification and command field parsing)
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    // Only handle requests that actually carry a slash command field
    if (params.has("command")) {
      // Verify Slack signing secret
      const valid = await verifySlackSignature(req, rawBody);
      if (!valid) {
        console.error("Slack signature verification failed");
        return new Response("Unauthorized", { status: 401 });
      }

      // Respond immediately to satisfy Slack's 3-second deadline
      // Run the real digest work in the background
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(runDigest());

      return new Response(
        JSON.stringify({
          response_type: "ephemeral",
          text: "Generating your digest... check your DMs shortly.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // Direct POST (cron job, manual curl) — run synchronously as before
  return await runDigest();
});
