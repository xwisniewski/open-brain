# Obsidian Integration Guide

## Opening the vault

1. Open Obsidian
2. Click **Open folder as vault** → select `~/Desktop/Second Brain Vault`
3. Start at `wiki/_index.md` — it's your home page with links to everything

---

## Capturing thoughts (unchanged)

DM the Second Brain bot on Slack or post in `#sb-inbox`. Flows into Supabase automatically.

---

## Syncing to Obsidian

The vault auto-updates every hour via launchd. To sync now:

**Terminal:**
```bash
cd ~/Desktop/Projects\ /SecondBrain/scripts
npm run export    # pull thoughts → raw/
npm run compile   # update wiki articles (incremental)
```

**From a Claude session (MCP tools):**
- `export_to_vault` — sync Supabase → raw/
- `compile_wiki` — incremental wiki update
- `compile_wiki` with `force: true` — recompile everything

---

## Vault structure

| Folder | Contents |
|--------|----------|
| `raw/thoughts/` | Every thought as .md, organized by category |
| `raw/projects/` | Project files with goals, constraints, decisions |
| `wiki/topics/` | LLM-synthesized articles per topic |
| `wiki/projects/` | Compiled project summaries |
| `wiki/people/` | People mentioned across thoughts |
| `wiki/_index.md` | Master index — start here |
| `queries/` | Save Q&A outputs here |

---

## Forcing a full recompile

```bash
npm run compile -- --force
```

---

## Checking the auto-export log

```bash
tail -f ~/Library/Logs/secondbrain-export.log
```

---

## Obsidian tips

- **Graph view** (`Cmd+G`) — see how topics connect
- **Search** (`Cmd+Shift+F`) — full-text search across raw + wiki
- **Backlinks panel** — see which raw thoughts fed a wiki article
- **Obsidian Web Clipper** (Chrome extension) — clip web articles into `raw/` for future compilation
