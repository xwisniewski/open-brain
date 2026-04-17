/**
 * export-to-vault.ts
 *
 * Pulls all thoughts and projects from Supabase and writes them as
 * markdown files into the Obsidian vault's raw/ directory.
 *
 * Run: npm run export
 * Auto: launchd plist fires this every hour
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../.env.local") });

const VAULT = path.resolve(
  process.env.HOME!,
  "Desktop/Second Brain Vault",
);
const RAW_THOUGHTS = path.join(VAULT, "raw/thoughts");
const RAW_PROJECTS = path.join(VAULT, "raw/projects");

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function writeIfChanged(filePath: string, content: string): boolean {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : null;
  if (existing === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// ── Thought export ────────────────────────────────────────────────────────────

interface Thought {
  id: string;
  raw_text: string;
  title: string;
  category: string;
  topics: string[];
  next_action: string | null;
  created_at: string;
  project_id: string | null;
}

async function exportThoughts(): Promise<number> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, raw_text, title, category, topics, next_action, created_at, project_id")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch thoughts: ${error.message}`);

  let written = 0;
  for (const t of data as Thought[]) {
    const date = new Date(t.created_at).toISOString().split("T")[0];
    const filename = `${date}-${slug(t.title)}.md`;
    const filePath = path.join(RAW_THOUGHTS, t.category, filename);

    const content = [
      `---`,
      `id: ${t.id}`,
      `title: "${t.title.replace(/"/g, '\\"')}"`,
      `category: ${t.category}`,
      `topics: [${(t.topics ?? []).map((x) => `"${x}"`).join(", ")}]`,
      `created_at: ${t.created_at}`,
      t.next_action ? `next_action: "${t.next_action.replace(/"/g, '\\"')}"` : null,
      `---`,
      ``,
      t.raw_text,
    ]
      .filter((l) => l !== null)
      .join("\n");

    if (writeIfChanged(filePath, content)) written++;
  }

  return written;
}

// ── Project export ────────────────────────────────────────────────────────────

interface Project {
  id: string;
  slug: string;
  name: string;
  status: string;
  description: string | null;
  goals: string | null;
  constraints: string | null;
  updated_at: string;
}

interface Decision {
  summary: string;
  rationale: string | null;
  made_at: string;
}

async function exportProjects(): Promise<number> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, slug, name, status, description, goals, constraints, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch projects: ${error.message}`);

  let written = 0;
  for (const p of projects as Project[]) {
    // Fetch decisions for this project
    const { data: decisions } = await supabase
      .from("project_decisions")
      .select("summary, rationale, made_at")
      .eq("project_id", p.id)
      .order("made_at", { ascending: false });

    const lines: string[] = [
      `---`,
      `slug: ${p.slug}`,
      `name: "${p.name}"`,
      `status: ${p.status}`,
      `updated_at: ${p.updated_at}`,
      `---`,
      ``,
      `# ${p.name}`,
      `**Status:** ${p.status}`,
    ];

    if (p.description) lines.push(``, p.description);
    if (p.goals) lines.push(``, `## Goals`, p.goals);
    if (p.constraints) lines.push(``, `## Constraints`, p.constraints);

    if (decisions && decisions.length > 0) {
      lines.push(``, `## Decisions`);
      for (const d of decisions as Decision[]) {
        const date = new Date(d.made_at).toLocaleDateString();
        lines.push(
          `- **${d.summary}**${d.rationale ? ` — ${d.rationale}` : ""} _(${date})_`,
        );
      }
    }

    const content = lines.join("\n");
    const filePath = path.join(RAW_PROJECTS, `${p.slug}.md`);
    if (writeIfChanged(filePath, content)) written++;
  }

  return written;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const start = Date.now();
  console.log(`[export] ${new Date().toISOString()} — starting`);

  const [thoughts, projects] = await Promise.all([
    exportThoughts(),
    exportProjects(),
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[export] done in ${elapsed}s — ${thoughts} thought(s), ${projects} project(s) written`,
  );
}

main().catch((err) => {
  console.error("[export] fatal:", err);
  process.exit(1);
});
