# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Open Brain" — a personal second brain system that captures thoughts from Slack, classifies and embeds them via Claude, stores them in Supabase with pgvector, and surfaces them through an MCP server for AI retrieval.

## Architecture

```
Slack #sb-inbox
    → Slack webhook
    → Supabase Edge Function (Deno)
        → Claude API (haiku-4-5 for classification + embedding)
        → Supabase Postgres (pgvector, thoughts table, vector(1536))

MCP Server (Node.js, self-hosted)
    → Claude API (Sonnet for digest/retrieval)
    → Supabase Postgres (cosine similarity search)

Cron Job → Daily digest → Slack DM
```

**Stack:**
- DB: Supabase Postgres (v17) + pgvector, `thoughts` table with `vector(1536)` column
- AI: `claude-haiku-4-5` for classification/embedding, `claude-sonnet-4-6` for digest
- Capture: Slack webhook on `#sb-inbox`
- MCP: Self-hosted Node.js server
- Edge Functions: Deno v2 runtime

## Build Phases

- [x] Phase 1: DB setup — pgvector enabled, `thoughts` table + indexes
- [x] Phase 2: Slack webhook → Edge Function → Claude API → DB
- [x] Phase 3: MCP server for AI retrieval
- [x] Phase 4: Daily digest cron → Slack DM (8am PST = 16:00 UTC)
- [x] Phase 5a: Duplicate ingest bug fixed
- [x] Phase 5b: Project context layer — fully live
- [x] Phase 6: Emergent pattern detection — insights table, `get_insights` MCP tool
- [x] Phase 7: Digest UX overhaul — Block Kit, Google Calendar/Gmail, Slack slash command, DM capture

## Supabase CLI Commands

```bash
# Start local Supabase stack (Postgres + Studio + Edge runtime)
supabase start

# Stop local stack
supabase stop

# Create a new Edge Function
supabase functions new <function-name>

# Serve Edge Functions locally (with hot reload)
supabase functions serve

# Run a single function locally for testing
supabase functions serve <function-name> --env-file .env.local

# Deploy an Edge Function to production
supabase functions deploy <function-name>

# Run migrations against local DB
supabase db push

# Open local Supabase Studio
# → http://localhost:54323

# Diff local schema against remote
supabase db diff
```

## Local URLs (when `supabase start` is running)

- API: `http://127.0.0.1:54321`
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio: `http://127.0.0.1:54323`
- Edge Functions: `http://127.0.0.1:54321/functions/v1/<name>`

## Deployment

```bash
# Deploy ingest function — MUST use --no-verify-jwt (Slack webhooks don't send Supabase JWTs)
supabase functions deploy ingest-thought --no-verify-jwt

# Deploy digest function — also needs --no-verify-jwt for slash command endpoint
supabase functions deploy daily-digest --no-verify-jwt
```

**Required Supabase secrets** (set via `supabase secrets set KEY=value`):
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_USER_ID` — `U0AJE85E3JT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

## Active Backlog (priority order)

1. **Dismiss stale actions** — 25+ accumulating; needs `/dismiss` Slack command or interactive button
2. **Smarter pattern deduplication** — "EY" and "onboarding" cluster separately; needs semantic grouping
3. **Multiple calendars** — currently only pulls primary Google Calendar

## Key Constraints

- Cost target: ~$0.10/month — prefer `claude-haiku-4-5` for high-frequency calls (classification, embedding), reserve Sonnet for digest only
- Embeddings dimension: `vector(1536)` — must match the embedding model output size
- Edge Functions run Deno v2; use Deno-compatible imports (no Node built-ins unless polyfilled)
