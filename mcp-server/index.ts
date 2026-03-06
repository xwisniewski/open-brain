import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { z } from "zod";

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
  version: "1.0.0",
});

server.tool(
  "search_thoughts",
  "Semantically search your second brain for thoughts, ideas, notes, and tasks",
  {
    query: z.string().describe("Natural language search query"),
    limit: z.number().int().min(1).max(20).default(5).describe("Number of results to return"),
  },
  async ({ query, limit }) => {
    const embedding = await embed(query);

    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: embedding,
      match_count: limit,
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
  },
  async ({ limit, category }) => {
    let query = supabase
      .from("thoughts")
      .select("id, raw_text, title, category, topics, next_action, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);

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

const transport = new StdioServerTransport();
await server.connect(transport);
