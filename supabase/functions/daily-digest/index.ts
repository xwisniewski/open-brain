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
${thoughtsList}

Write a brief, friendly daily digest (3-5 sentences max). Highlight key themes, any action items, and notable ideas. Be concise and useful — this is a morning briefing.`,
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
  const message = `*🧠 Daily Second Brain Digest*\n_${count} thought${count !== 1 ? "s" : ""} captured in the last 24 hours_\n\n${digest}`;

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

  console.log(`Digest sent: ${count} thoughts`);
  return new Response("ok", { status: 200 });
});
