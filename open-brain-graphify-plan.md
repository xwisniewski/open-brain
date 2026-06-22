# Graphify Integration Plan — Open Brain (Second Brain)

**Repo:** Open Brain (personal second-brain system)
**Stack:** Supabase (Postgres + pgvector), Node.js MCP server, Slack capture, Claude Haiku classification, Obsidian wiki output
**Goal:** Two tracks. (A) Dogfood graphify on the second-brain *codebase*. (B) The more interesting one — run graphify over the *compiled Obsidian wiki* to get a **structural concept graph across your notes**, which is complementary to the embedding/semantic search you already have.

> You are Claude Code operating inside this repo. Pause at each `CHECKPOINT`. Don't invent credentials.

---

## Phase 0 — Prereqs

```bash
# postgres for schema introspection; office/pdf only if your notes include those file types
uv tool install "graphifyy[postgres,office,pdf]"
graphify --version
graphify claude install
```

`.graphifyignore`:

```
node_modules/
dist/
.env*
*.log
```

---

## Track A — Graph the codebase

```bash
/graphify .
```

Report from `GRAPH_REPORT.md`:
- god nodes — expect the MCP server entrypoint and the classification pipeline to dominate.
- Map the capture→store flow:

```bash
graphify query "how does a Slack message flow from capture to classification to Supabase storage?"
graphify query "where does the Claude Haiku classifier connect to the embedding/pgvector write?"
```

Optionally add the Supabase schema (read-only DSN via env var):

```bash
# export BRAIN_RO_DSN="postgresql://readonly:...@db.<project>.supabase.co:5432/postgres"
graphify extract . --postgres "$BRAIN_RO_DSN"
```

**CHECKPOINT** — share the capture-pipeline map with Xavier.

---

## Track B — Graph the notes themselves (the interesting part)

Your second brain stores thoughts as **embeddings** (good for "find me things like X"). Graphify builds a **structural graph** (good for "what concepts connect to what, across notes"). Running it over the compiled wiki gives you a view you don't currently have.

```bash
# Point graphify at the compiled Obsidian vault's markdown.
# (Run compile_wiki / export_to_vault first so the vault is current.)
graphify ./<path-to-obsidian-vault>/raw --obsidian
```

Then explore:

```bash
graphify query "what are the most-connected themes across my notes?"
graphify query "what surprising connections exist between different projects in my notes?"
```

Report the **god-node concepts** (your recurring themes) and the **surprising connections** (links between notes in different folders/projects) — these are exactly the emergent patterns a second brain is supposed to surface but embedding search alone won't show as structure.

**CHECKPOINT** — Xavier reviews whether the structural view is worth wiring in permanently. If yes, consider:
- adding a scheduled step that re-runs graphify after each `compile_wiki`, and
- exposing the notes graph as an MCP server so your assistant can query note-structure directly:
  ```bash
  python -m graphify.serve graphify-out/graph.json   # stdio MCP
  ```

---

## Definition of done
- [ ] codebase graph built; capture→classify→store flow mapped
- [ ] wiki/notes graph built via `--obsidian`
- [ ] recurring-theme god nodes + cross-project surprising connections reported
- [ ] decision logged on whether to make the notes graph a standing part of the pipeline

## Guardrails / notes
- Notes/markdown extraction uses an LLM (small cost); code extraction is local/free.
- Read-only DSN via env var only.
- This is complementary to pgvector search, not a replacement — structural graph vs semantic similarity.
