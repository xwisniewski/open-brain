/**
 * compile-wiki.ts
 *
 * Reads raw/ markdown files in the Obsidian vault, identifies which
 * topics/projects/people need recompilation (incremental via state file),
 * calls Claude to synthesize wiki articles, and writes them to wiki/.
 *
 * Run: npm run compile
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../.env.local") });

const VAULT = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : path.resolve(process.env.HOME!, "Desktop/Second Brain Vault");
const RAW_DIR = path.join(VAULT, "raw");
const WIKI_DIR = path.join(VAULT, "wiki");
const STATE_FILE = path.join(VAULT, ".compile-state.json");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SCHEMA_FILE = path.join(VAULT, "WIKI_SCHEMA.md");
const wikiSchema = fs.existsSync(SCHEMA_FILE) ? fs.readFileSync(SCHEMA_FILE, "utf8") : "";

// ── State tracking ─────────────────────────────────────────────────────────

interface CompileState {
  lastRun: string;
  compiled: Record<string, string>; // articleKey → ISO timestamp of last compile
}

function loadState(): CompileState {
  if (!fs.existsSync(STATE_FILE)) {
    return { lastRun: new Date(0).toISOString(), compiled: {} };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as CompileState;
}

function saveState(state: CompileState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// ── Raw file helpers ────────────────────────────────────────────────────────

interface RawFile {
  filePath: string;
  content: string;
  modifiedAt: Date;
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k && rest.length) fm[k.trim()] = rest.join(":").trim();
  }
  return { fm, body: match[2] };
}

function readRawFiles(dir: string): RawFile[] {
  if (!fs.existsSync(dir)) return [];
  const results: RawFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readRawFiles(full));
    } else if (entry.name.endsWith(".md")) {
      const content = fs.readFileSync(full, "utf8");
      const stat = fs.statSync(full);
      const { fm, body } = parseFrontmatter(content);
      results.push({ filePath: full, content, modifiedAt: stat.mtime, frontmatter: fm, body });
    }
  }
  return results;
}

// ── Topic extraction ────────────────────────────────────────────────────────

interface TopicGroup {
  key: string;            // e.g. "topic:ey-onboarding" or "project:open-brain" or "person:sarah"
  label: string;          // human name
  type: "topic" | "project" | "person";
  files: RawFile[];
  newestModified: Date;
}

function groupByTopics(rawFiles: RawFile[]): Map<string, TopicGroup> {
  const groups = new Map<string, TopicGroup>();

  function upsert(key: string, label: string, type: TopicGroup["type"], file: RawFile): void {
    const existing = groups.get(key);
    if (existing) {
      existing.files.push(file);
      if (file.modifiedAt > existing.newestModified) {
        existing.newestModified = file.modifiedAt;
      }
    } else {
      groups.set(key, { key, label, type, files: [file], newestModified: file.modifiedAt });
    }
  }

  for (const file of rawFiles) {
    const relativePath = path.relative(RAW_DIR, file.filePath);

    // Project files → compile as project articles
    if (relativePath.startsWith("projects/")) {
      const slug = file.frontmatter["slug"] ?? path.basename(file.filePath, ".md");
      const label = file.frontmatter["name"]?.replace(/^"|"$/g, "") ?? slug;
      upsert(`project:${slug}`, label, "project", file);
      continue;
    }

    // Thought files → group by topic tags
    const topicsRaw = file.frontmatter["topics"] ?? "";
    const topics = topicsRaw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((t) => t.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    // Also check if it looks like a person mention (category: people)
    const category = file.frontmatter["category"] ?? "";

    if (category === "people") {
      // Extract person name from title
      const title = file.frontmatter["title"]?.replace(/^"|"$/g, "") ?? "";
      const personKey = `person:${slug(title)}`;
      upsert(personKey, title, "person", file);
    }

    for (const topic of topics) {
      upsert(`topic:${slug(topic)}`, topic, "topic", file);
    }
  }

  return groups;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// ── Claude compilation ──────────────────────────────────────────────────────

async function compileArticle(
  group: TopicGroup,
  allPageLabels: string[],
  existingContent: string | null,
): Promise<string> {
  const sourceFiles = group.files
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  const rawContent = sourceFiles
    .map((f) => `### Source: ${path.basename(f.filePath)}\n\n${f.body.trim()}`)
    .join("\n\n---\n\n");

  // Other known wiki pages for cross-referencing (exclude self)
  const linkablePages = allPageLabels.filter(
    (l) => l.toLowerCase() !== group.label.toLowerCase(),
  );

  const typeInstructions: Record<TopicGroup["type"], string> = {
    topic: `Write a wiki article about the topic "${group.label}". Synthesize patterns, key ideas, and any actions or decisions across the notes. Include a ## Summary, ## Key Ideas, and ## Open Questions section.`,
    project: `Write a wiki article for the project "${group.label}". Include ## Overview, ## Goals, ## Decisions, ## Current Status, and ## Next Steps sections based on the source material.`,
    person: `Write a wiki article about the person "${group.label}". Summarize context about this person, relevant interactions, and any open threads or next actions.`,
  };

  const wikilinkInstruction = linkablePages.length > 0
    ? `\nWhere relevant, cross-reference related topics using Obsidian wikilinks: [[Page Name]]. Only use names from this exact list — do not invent links:\n${linkablePages.map((l) => `  - ${l}`).join("\n")}`
    : "";

  const contradictionInstruction = existingContent
    ? `\n\nEXISTING WIKI PAGE (check for contradictions):\n${existingContent}\n\nIf any new source material contradicts the existing content above, add a ## ⚠️ Contradictions section noting the conflict. If there are no contradictions, omit that section entirely.`
    : "";

  const schemaSection = wikiSchema
    ? `\n\nKNOWLEDGE BASE SCHEMA (follow this for structure and tone):\n${wikiSchema}\n`
    : "";

  const prompt = `You are maintaining a personal knowledge wiki. Below are raw notes and thoughts captured over time.${schemaSection}
${typeInstructions[group.type]}
${wikilinkInstruction}

Be concise and factual. Use the first-person perspective of the note-taker. Do not invent details not present in the sources. Use markdown formatting. End with a ## Sources section listing the source filenames.${contradictionInstruction}

---

${rawContent}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  const sourceFilenames = sourceFiles.map((f) => path.basename(f.filePath)).join(", ");
  const now = new Date().toISOString();
  const header = [
    `---`,
    `type: ${group.type}`,
    `label: "${group.label}"`,
    `source_count: ${group.files.length}`,
    `source_files: ${sourceFilenames}`,
    `compiled_at: ${now}`,
    `---`,
    ``,
  ].join("\n");

  return header + text;
}

// ── Write wiki article ──────────────────────────────────────────────────────

function wikiPath(group: TopicGroup): string {
  const dir = {
    topic: path.join(WIKI_DIR, "topics"),
    project: path.join(WIKI_DIR, "projects"),
    person: path.join(WIKI_DIR, "people"),
  }[group.type];

  const filename = `${slug(group.label)}.md`;
  return path.join(dir, filename);
}

// ── Index file ──────────────────────────────────────────────────────────────

function writeIndex(groups: Map<string, TopicGroup>): void {
  const byType = (type: TopicGroup["type"]) =>
    [...groups.values()]
      .filter((g) => g.type === type)
      .sort((a, b) => a.label.localeCompare(b.label));

  const lines = [
    `# Second Brain Wiki Index`,
    ``,
    `_Last compiled: ${new Date().toLocaleString()}_`,
    ``,
    `## Projects`,
    ...byType("project").map((g) => `- [[projects/${slug(g.label)}|${g.label}]] (${g.files.length} notes)`),
    ``,
    `## Topics`,
    ...byType("topic").map((g) => `- [[topics/${slug(g.label)}|${g.label}]] (${g.files.length} notes)`),
    ``,
    `## People`,
    ...byType("person").map((g) => `- [[people/${slug(g.label)}|${g.label}]] (${g.files.length} notes)`),
  ];

  fs.writeFileSync(path.join(WIKI_DIR, "_index.md"), lines.join("\n"), "utf8");
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function compileWiki(forceAll = false): Promise<{ compiled: number; skipped: number }> {
  const state = loadState();
  const rawFiles = readRawFiles(RAW_DIR);

  if (rawFiles.length === 0) {
    console.log("[compile] no raw files found — run export first");
    return { compiled: 0, skipped: 0 };
  }

  const groups = groupByTopics(rawFiles);
  const allPageLabels = [...groups.values()].map((g) => g.label);
  let compiled = 0;
  let skipped = 0;

  for (const group of groups.values()) {
    const lastCompiled = state.compiled[group.key]
      ? new Date(state.compiled[group.key])
      : new Date(0);

    // Skip if no files have changed since last compile
    if (!forceAll && group.newestModified <= lastCompiled) {
      skipped++;
      continue;
    }

    const outPath = wikiPath(group);
    const existingContent = fs.existsSync(outPath)
      ? fs.readFileSync(outPath, "utf8")
      : null;

    console.log(`[compile] ${group.key} (${group.files.length} sources)`);
    try {
      const article = await compileArticle(group, allPageLabels, existingContent);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, article, "utf8");
      state.compiled[group.key] = new Date().toISOString();
      compiled++;
    } catch (err) {
      console.error(`[compile] failed for ${group.key}:`, err);
    }
  }

  writeIndex(groups);
  state.lastRun = new Date().toISOString();
  saveState(state);

  return { compiled, skipped };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const forceAll = process.argv.includes("--force");
  const start = Date.now();
  console.log(`[compile] ${new Date().toISOString()} — starting${forceAll ? " (force)" : ""}`);

  const { compiled, skipped } = await compileWiki(forceAll);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[compile] done in ${elapsed}s — ${compiled} compiled, ${skipped} skipped`);
}

main().catch((err) => {
  console.error("[compile] fatal:", err);
  process.exit(1);
});
