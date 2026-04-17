import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

const server = new McpServer({
  name: "second-brain",
  version: "2.0.0",
});

// ── Thought tools ─────────────────────────────────────────────────────────────

server.tool(
  "search_thoughts",
  "Semantically search your second brain for thoughts, ideas, notes, and tasks",
  {
    query: z.string().describe("Natural language search query"),
    limit: z.number().int().min(1).max(20).default(5).describe("Number of results to return"),
    project_slug: z.string().optional().describe("Scope search to a specific project slug"),
  },
  async ({ query, limit, project_slug }) => {
    const embedding = await embed(query);

    // If scoped to a project, resolve its id first
    let projectId: string | null = null;
    if (project_slug) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", project_slug)
        .maybeSingle();
      if (!project) {
        return { content: [{ type: "text", text: `Unknown project slug: ${project_slug}` }] };
      }
      projectId = project.id;
    }

    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: embedding,
      match_count: limit,
      ...(projectId ? { filter_project_id: projectId } : {}),
    });

    if (error) throw new Error(`Search failed: ${error.message}`);

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No matching thoughts found." }] };
    }

    const results = data.map((t: {
      id: string;
      raw_text: string;
      title: string;
      category: string;
      topics: string[];
      next_action: string | null;
      created_at: string;
      similarity: number;
    }) => `[${t.category}] ${t.title}
${t.raw_text}
Topics: ${t.topics?.join(", ") || "none"}${t.next_action ? `\nNext action: ${t.next_action}` : ""}
Similarity: ${(t.similarity * 100).toFixed(0)}% | ${new Date(t.created_at).toLocaleDateString()}
---`).join("\n");

    return { content: [{ type: "text", text: results }] };
  },
);

server.tool(
  "get_recent_thoughts",
  "Get the most recent thoughts captured in your second brain",
  {
    limit: z.number().int().min(1).max(20).default(10).describe("Number of thoughts to return"),
    category: z.enum(["people", "projects", "ideas", "admin", "needs_review"]).optional().describe("Filter by category"),
    project_slug: z.string().optional().describe("Filter by project slug"),
  },
  async ({ limit, category, project_slug }) => {
    let projectId: string | null = null;
    if (project_slug) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", project_slug)
        .maybeSingle();
      if (!project) {
        return { content: [{ type: "text", text: `Unknown project slug: ${project_slug}` }] };
      }
      projectId = project.id;
    }

    let query = supabase
      .from("thoughts")
      .select("id, raw_text, title, category, topics, next_action, created_at, project_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);
    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) throw new Error(`Query failed: ${error.message}`);

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No thoughts found." }] };
    }

    const results = data.map((t) => `[${t.category}] ${t.title}
${t.raw_text}
Topics: ${t.topics?.join(", ") || "none"}${t.next_action ? `\nNext action: ${t.next_action}` : ""}
${new Date(t.created_at).toLocaleDateString()}
---`).join("\n");

    return { content: [{ type: "text", text: results }] };
  },
);

// ── Project tools ─────────────────────────────────────────────────────────────

server.tool(
  "get_project_context",
  "Load full context for a project — goals, constraints, decisions, and recent thoughts. Use this at the start of any session to get up to speed.",
  {
    project_slug: z.string().describe("The project slug, e.g. 'ey-onboarding' or 'open-brain'"),
  },
  async ({ project_slug }) => {
    const { data, error } = await supabase.rpc("get_project_context", {
      p_slug: project_slug,
    });

    if (error) throw new Error(`Failed to load project: ${error.message}`);
    if (!data) {
      return { content: [{ type: "text", text: `No project found with slug: ${project_slug}` }] };
    }

    const { project, decisions, recent_thoughts } = data as {
      project: {
        name: string;
        slug: string;
        status: string;
        description: string | null;
        goals: string | null;
        constraints: string | null;
        updated_at: string;
      };
      decisions: Array<{ summary: string; rationale: string | null; made_at: string; source: string }>;
      recent_thoughts: Array<{ title: string; raw_text: string; category: string; next_action: string | null; created_at: string }>;
    };

    const lines: string[] = [
      `# ${project.name} [${project.status}]`,
      `Slug: ${project.slug} | Last updated: ${new Date(project.updated_at).toLocaleDateString()}`,
    ];

    if (project.description) lines.push(`\n${project.description}`);
    if (project.goals) lines.push(`\n## Goals\n${project.goals}`);
    if (project.constraints) lines.push(`\n## Constraints\n${project.constraints}`);

    if (decisions.length > 0) {
      lines.push("\n## Decisions");
      decisions.forEach((d) => {
        lines.push(`• ${d.summary}${d.rationale ? ` — ${d.rationale}` : ""} (${new Date(d.made_at).toLocaleDateString()})`);
      });
    }

    if (recent_thoughts.length > 0) {
      lines.push("\n## Recent thoughts");
      recent_thoughts.forEach((t) => {
        lines.push(`• [${t.category}] ${t.title}${t.next_action ? ` → ${t.next_action}` : ""} (${new Date(t.created_at).toLocaleDateString()})`);
      });
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.tool(
  "list_projects",
  "List all projects in your second brain with their status and recent activity",
  {
    status: z.enum(["active", "paused", "done"]).optional().describe("Filter by status (default: all)"),
  },
  async ({ status }) => {
    let query = supabase
      .from("projects")
      .select("id, slug, name, status, description, updated_at")
      .order("updated_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data: projects, error } = await query;
    if (error) throw new Error(`Failed to list projects: ${error.message}`);
    if (!projects || projects.length === 0) {
      return { content: [{ type: "text", text: "No projects found." }] };
    }

    // Get thought counts per project
    const { data: counts } = await supabase
      .from("thoughts")
      .select("project_id")
      .in("project_id", projects.map((p) => p.id));

    const countMap: Record<string, number> = {};
    (counts ?? []).forEach((t) => {
      if (t.project_id) countMap[t.project_id] = (countMap[t.project_id] ?? 0) + 1;
    });

    const lines = projects.map((p) => {
      const n = countMap[p.id] ?? 0;
      return `[${p.status}] ${p.name} (${p.slug})
${p.description ?? "No description"}
${n} thought${n !== 1 ? "s" : ""} | Last updated: ${new Date(p.updated_at).toLocaleDateString()}
---`;
    });

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.tool(
  "log_decision",
  "Log a decision against a project. Use this mid-session to capture decisions without switching to Slack.",
  {
    project_slug: z.string().describe("The project slug"),
    summary: z.string().describe("One-line summary of the decision made"),
    rationale: z.string().optional().describe("Why this decision was made"),
  },
  async ({ project_slug, summary, rationale }) => {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("slug", project_slug)
      .maybeSingle();

    if (projectError) throw new Error(`DB error: ${projectError.message}`);
    if (!project) {
      return { content: [{ type: "text", text: `No project found with slug: ${project_slug}` }] };
    }

    const { error } = await supabase.from("project_decisions").insert({
      project_id: project.id,
      summary,
      rationale: rationale ?? null,
      source: "ai-session",
    });

    if (error) throw new Error(`Failed to log decision: ${error.message}`);

    return {
      content: [{
        type: "text",
        text: `Decision logged for "${project.name}":\n• ${summary}${rationale ? `\n  Rationale: ${rationale}` : ""}`,
      }],
    };
  },
);

server.tool(
  "get_insights",
  "Get emergent patterns detected across your second brain — recurring topics, stale actions, frequent people, suggested project clusters",
  {
    status: z.enum(["new", "seen", "dismissed", "all"]).default("new"),
    type: z.enum(["suggested_project", "recurring_action", "stale_action", "recurring_person", "all"]).default("all"),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async ({ status, type, limit }) => {
    let query = supabase
      .from("insights")
      .select("id, type, title, detail, status, detected_at")
      .order("detected_at", { ascending: false })
      .limit(limit);

    if (status !== "all") query = query.eq("status", status);
    if (type !== "all") query = query.eq("type", type);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch insights: ${error.message}`);
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No insights found." }] };
    }

    const typeLabels: Record<string, string> = {
      suggested_project: "SUGGESTED PROJECT",
      recurring_action: "RECURRING ACTION",
      stale_action: "STALE ACTION",
      recurring_person: "RECURRING PERSON",
    };

    const lines = data.map((ins) => {
      const label = typeLabels[ins.type] ?? ins.type.toUpperCase();
      const age = Math.floor((Date.now() - new Date(ins.detected_at).getTime()) / (1000 * 60 * 60));
      const ageStr = age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
      const detail = ins.detail as Record<string, unknown>;
      let detailStr = "";
      if (ins.type === "suggested_project" || ins.type === "recurring_person" || ins.type === "recurring_action") {
        detailStr = ` (${detail.count}x)`;
      } else if (ins.type === "stale_action") {
        detailStr = ` (${detail.days_old} days old)`;
      }
      return `[${label}] ${ins.title}${detailStr} — ${ins.status} | ${ageStr}`;
    });

    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ── Thought capture ────────────────────────────────────────────────────────

server.tool(
  "log_thought",
  "Capture a freeform note or progress update directly into your second brain from a Claude session. Classifies, embeds, and stores it in Supabase — pick it up with compile_wiki to push to Obsidian.",
  {
    text: z.string().describe("The note or progress update to capture"),
    project_slug: z.string().optional().describe("Associate with a project slug, e.g. 'open-brain'"),
  },
  async ({ text, project_slug }) => {
    // Resolve project id if given
    let projectId: string | null = null;
    if (project_slug) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("slug", project_slug)
        .maybeSingle();
      if (!project) {
        return { content: [{ type: "text", text: `Unknown project slug: ${project_slug}` }] };
      }
      projectId = project.id;
    }

    // Embed
    const embedding = await embed(text);

    // Classify via a quick Claude Haiku call
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const classifyRes = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: `Classify this note. Reply with JSON only, no prose.

Note: "${text}"

JSON fields:
- title: string (short, descriptive, max 60 chars)
- category: one of "people" | "projects" | "ideas" | "admin" | "needs_review"
- topics: string[] (2-5 relevant tags, lowercase, hyphenated)
- next_action: string | null (if there's a clear next step)`,
      }],
    });

    let title = text.slice(0, 60);
    let category = "needs_review";
    let topics: string[] = [];
    let next_action: string | null = null;

    try {
      const raw = classifyRes.content[0].type === "text" ? classifyRes.content[0].text : "{}";
      const parsed = JSON.parse(raw.replace(/```json\n?|```/g, "").trim()) as {
        title?: string;
        category?: string;
        topics?: string[];
        next_action?: string | null;
      };
      title = parsed.title ?? title;
      category = parsed.category ?? category;
      topics = parsed.topics ?? topics;
      next_action = parsed.next_action ?? null;
    } catch {
      // keep defaults
    }

    const { error } = await supabase.from("thoughts").insert({
      raw_text: text,
      title,
      category,
      topics,
      next_action,
      embedding,
      ...(projectId ? { project_id: projectId } : {}),
    });

    if (error) throw new Error(`Failed to save thought: ${error.message}`);

    return {
      content: [{
        type: "text",
        text: `Captured: "${title}" [${category}]${next_action ? `\nNext action: ${next_action}` : ""}\nRun compile_wiki to push to Obsidian.`,
      }],
    };
  },
);

// ── Obsidian vault tools ───────────────────────────────────────────────────

server.tool(
  "compile_wiki",
  "Compile or recompile the Obsidian wiki from raw vault notes. Runs incrementally by default (only topics with new raw files since last compile). Use force=true to recompile everything.",
  {
    force: z.boolean().default(false).describe("Recompile all articles even if unchanged"),
  },
  async ({ force }) => {
    const scriptsDir = path.resolve(__dirname, "../scripts");
    const args = ["--loader", "ts-node/esm", "compile-wiki.ts"];
    if (force) args.push("--force");

    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        args,
        {
          cwd: scriptsDir,
          env: { ...process.env },
          timeout: 120_000,
        },
      );
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { content: [{ type: "text", text: output || "Compile complete." }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Wiki compile failed: ${message}`);
    }
  },
);

server.tool(
  "export_to_vault",
  "Export all thoughts and projects from Supabase into the Obsidian vault's raw/ directory as markdown files.",
  {},
  async () => {
    const scriptsDir = path.resolve(__dirname, "../scripts");

    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        ["--loader", "ts-node/esm", "export-to-vault.ts"],
        {
          cwd: scriptsDir,
          env: { ...process.env },
          timeout: 60_000,
        },
      );
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { content: [{ type: "text", text: output || "Export complete." }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Export failed: ${message}`);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
