import { createClient } from "jsr:@supabase/supabase-js@2";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const SLACK_API_URL = "https://slack.com/api";

Deno.serve(async () => {
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
    for (const row of (staleActions.data ?? [])) {
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
      suggested_project: 3,
      recurring_action: 3,
      stale_action: 5,
      recurring_person: 3,
    };
    const displayCounts: Record<string, number> = {};

    for (const insight of insightRows) {
      const { data: exists } = await supabase.rpc("insight_exists", {
        p_type: insight.type,
        p_title: insight.title,
      });
      if (!exists) {
        await supabase.from("insights").insert(insight);
      }
      // Build display line (cap per type regardless of novelty)
      displayCounts[insight.type] = (displayCounts[insight.type] ?? 0) + 1;
      if (displayCounts[insight.type] > displayCaps[insight.type]) continue;

      let line = "";
      if (insight.type === "suggested_project") {
        line = `• Suggested project: _${insight.title}_ (${(insight.detail as { count: number }).count}x this week)`;
      } else if (insight.type === "recurring_action") {
        line = `• Recurring action: "${insight.title}" (${(insight.detail as { count: number }).count}x)`;
      } else if (insight.type === "stale_action") {
        line = `• Stale action: "${insight.title}" — ${(insight.detail as { days_old: number }).days_old} days old`;
      } else if (insight.type === "recurring_person") {
        line = `• Frequent mention: _${insight.title}_ (${(insight.detail as { count: number }).count}x)`;
      }
      if (line) patternLines.push(line);
    }

    // Append overflow notes per type
    for (const [type, cap] of Object.entries(displayCaps)) {
      const total = displayCounts[type] ?? 0;
      if (total > cap) {
        const label = type.replace(/_/g, " ");
        patternLines.push(`  _…and ${total - cap} more ${label}s_`);
      }
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
    `- [${t.category}] ${t.title}: "${t.raw_text}"${t.next_action ? ` → Next: ${t.next_action}` : ""}${t.topics?.length ? ` (${t.topics.join(", ")})` : ""}`
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
          content: `You are a personal assistant summarizing someone's second brain capture for the day.

Here are the thoughts captured in the last 24 hours:
${thoughtsList}${patternSection}

Write a brief, friendly daily digest (3-5 sentences max). Highlight key themes, any action items, and notable ideas. Be concise and useful — this is a morning briefing. Do not use markdown headers or section titles — plain prose only.`,
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

  // 2d. Append pattern callout to Slack message if insights exist
  const patternBlock = patternLines.length > 0
    ? `\n\n*🔍 Patterns this week*\n${patternLines.join("\n")}`
    : "";

  const message = `*🧠 Daily Second Brain Digest*\n_${count} thought${count !== 1 ? "s" : ""} captured in the last 24 hours_\n\n${digest}${patternBlock}`;

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
      text: message,
    }),
  });

  const postData = await postRes.json();
  if (!postData.ok) {
    console.error("Slack post error:", postData.error);
    return new Response("Slack post error", { status: 500 });
  }

  console.log(`Digest sent: ${count} thoughts, ${patternLines.length} new insights`);
  return new Response("ok", { status: 200 });
});
