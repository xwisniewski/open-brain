# Graphify Integration

Graphify builds a **structural concept graph** over both the codebase and the compiled Obsidian wiki. It is complementary to the pgvector semantic search already in the system:

| Layer | Tool | Good for |
|---|---|---|
| Semantic similarity | pgvector (`search_thoughts`) | "Find notes like X" |
| Structural graph | graphify | "What concepts connect to X across all notes" |

---

## Two graphs

### 1. Codebase graph

**Location:** `graphify-out/graph.json`
**Built from:** AST extraction of all TypeScript/shell files — no LLM, no cost
**Rebuilt with:** `graphify update .` (run after code changes)

What it found (as of initial build):
- **`compileWiki()`** is the most-connected node (9 edges) — hub of the Obsidian pipeline
- **`processMessage()`** is the isolated ingest core (Community 11, 2 edges) — Slack → classify → store happens entirely inside this one function with no cross-file deps
- Three pipelines are structurally separate: **ingest** (Community 11) ↔ **MCP retrieval** (Community 4) ↔ **Obsidian export** (Community 3). They only share the Supabase database at runtime.

### 2. Notes concept graph

**Location:** `~/Desktop/Second Brain Vault/wiki/graphify-out/graph.json`
**Built from:** Semantic extraction of compiled wiki articles via OpenAI (~$0.02/rebuild)
**Rebuilt with:** `scripts/graphify-notes.sh` (run after `compile_wiki`)

What it found (initial build, 90 articles):
- **EY Onboarding** is the single highest-connected concept (4 edges) — pulls in administration, workflows, and onboarding as structural neighbors
- **AI Ethics Policy** is the tightest community (cohesion 0.50): `AI disclosure`, `AI ethics`, `AI tools`, `academic integrity`, `policy` all cluster together — a recurring concern that embedding search only surfaces if you query for it
- Your three personal projects (`Open Brain`, `Social Pipeline`, `Unlok PM`) are currently isolated nodes — no cross-references between them. The graph will connect them once you capture thoughts that mention multiple projects in the same note.

---

## Daily use

### Claude Code sessions (codebase questions)
Graphify hooks are already wired in `.claude/settings.json` — Claude will automatically run `graphify query` before reading source files. You don't need to do anything.

Manual queries when useful:
```bash
# Explore a flow
graphify query "how does the digest pipeline work?"

# Find the relationship between two things
graphify path "processMessage()" "compileWiki()"

# Understand a specific node
graphify explain "runDigest()"
```

### After code changes
```bash
graphify update .
```
No API cost. Updates the codebase graph in place.

### After compile_wiki
```bash
./scripts/graphify-notes.sh
```
Rebuilds the notes concept graph. Requires `OPENAI_API_KEY` (loaded automatically from `.env.local`). Cost ~$0.02 for 90 articles.

### Querying the notes graph
```bash
GRAPH="$HOME/Desktop/Second Brain Vault/wiki/graphify-out/graph.json"

graphify query "what are the most-connected themes across my notes?" --graph "$GRAPH"
graphify query "what connects to EY Onboarding?" --graph "$GRAPH"
graphify explain "academic integrity" --graph "$GRAPH"
```

### Notes graph as an MCP tool
`.mcp.json` registers `graphify-mcp` as a project MCP server (`notes-graph`). When active in a Claude Code session, the assistant can query your note structure directly — same graph query interface, but called as a tool rather than CLI.

---

## Keeping graphs fresh

| Event | Action |
|---|---|
| Code files changed | `graphify update .` |
| New thoughts exported + wiki compiled | `./scripts/graphify-notes.sh` |
| Major refactor (files deleted) | `GRAPHIFY_FORCE=1 graphify update .` |

---

## Files added

| File | Purpose |
|---|---|
| `graphify-out/` | Codebase graph output (graph.json, GRAPH_REPORT.md, graph.html) |
| `.graphifyignore` | Excludes binaries, env files, build artifacts from extraction |
| `.mcp.json` | Registers notes-graph MCP server for Claude Code sessions |
| `scripts/graphify-notes.sh` | Rebuilds the notes concept graph after compile_wiki |
| `CLAUDE.md` (graphify section) | Rules injected into every session: query graph before grepping |
