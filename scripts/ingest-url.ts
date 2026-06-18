/**
 * ingest-url.ts
 *
 * Fetches a URL, extracts the key content with Claude Haiku,
 * and writes a structured markdown source file into raw/sources/.
 * The compile-wiki step picks it up automatically via topic tags.
 *
 * Run: npm run ingest -- <url> [notes]
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../.env.local") });

const VAULT = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.env.HOME!, "Desktop/Second Brain Vault");
const SOURCES_DIR = path.join(VAULT, "raw/sources");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SecondBrainBot/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50_000);
}

interface IngestResult {
  title: string;
  topics: string[];
  outPath: string;
}

export async function ingestUrl(url: string, notes?: string): Promise<IngestResult> {
  console.log(`[ingest-url] fetching ${url}`);
  const pageText = await fetchPageText(url);

  const prompt = `You are processing a web article for a personal knowledge wiki.

URL: ${url}${notes ? `\nUser notes: ${notes}` : ""}

Article content (stripped HTML):
${pageText}

Extract the most valuable information and respond with JSON only (no prose, no markdown fences):
{
  "title": "short descriptive article title",
  "topics": ["tag1", "tag2", "tag3"],
  "summary": "2-3 sentence summary of the key ideas",
  "article": "clean markdown article — headings, paragraphs, key points; remove ads, nav, boilerplate"
}

Topics should be 3-7 lowercase hyphenated tags relevant to the content.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const parsed = JSON.parse(raw.replace(/```json\n?|```/g, "").trim()) as {
    title: string;
    topics: string[];
    summary: string;
    article: string;
  };

  const filename = `${slugify(parsed.title)}.md`;
  const outPath = path.join(SOURCES_DIR, filename);
  fs.mkdirSync(SOURCES_DIR, { recursive: true });

  const content = [
    `---`,
    `type: source`,
    `title: "${parsed.title.replace(/"/g, '\\"')}"`,
    `url: ${url}`,
    `topics: [${parsed.topics.map((t) => `"${t}"`).join(", ")}]`,
    `ingested_at: ${new Date().toISOString()}`,
    `---`,
    ``,
    `> ${parsed.summary}`,
    ``,
    `_Source: ${url}_`,
    ``,
    parsed.article,
    notes ? `\n## My Notes\n\n${notes}` : "",
  ].filter((l) => l !== undefined).join("\n");

  fs.writeFileSync(outPath, content, "utf8");
  console.log(`[ingest-url] wrote ${filename}`);

  return { title: parsed.title, topics: parsed.topics, outPath };
}

async function main(): Promise<void> {
  const url = process.argv[2];
  const notes = process.argv[3];
  if (!url) {
    console.error("Usage: npm run ingest -- <url> [notes]");
    process.exit(1);
  }
  const { title, topics, outPath } = await ingestUrl(url, notes);
  console.log(`\nIngested: "${title}"\nTopics: ${topics.join(", ")}\nFile: ${outPath}`);
  console.log("\nRun npm run compile to update the wiki.");
}

main().catch((err) => {
  console.error("[ingest-url] fatal:", err);
  process.exit(1);
});
