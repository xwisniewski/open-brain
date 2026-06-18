# Open Brain

Open Brain is a private, single-user second brain. It captures Slack messages,
classifies and embeds them, stores them in Supabase, exposes retrieval tools over
MCP, and can send a daily Slack digest.

Each user should own their own Supabase project, Slack app, AI API keys, and
optional Google OAuth credentials. No personal notes or existing database data
need to be included when sharing the application code.

After setup, a Slack-only user does not need a local checkout. Using the MCP
tools or optional Obsidian integration requires the clean application package on
their computer, but never the original owner's personal files.

## What A New User Gets

- Slack DM or channel capture
- Semantic search and project context through an MCP server
- Daily Slack digest with pattern detection
- Optional Google Calendar and Gmail context
- Optional Obsidian export and compiled wiki

## Start Here

- New user: [First-time setup](docs/FIRST_TIME_SETUP.md)
- Current owner: [Handoff checklist](docs/HANDOFF.md)
- Optional Obsidian integration: [Obsidian guide](OBSIDIAN_GUIDE.md)

## Repository Layout

| Path | Purpose |
| --- | --- |
| `supabase/migrations/` | Complete database schema for a fresh deployment |
| `supabase/functions/ingest-thought/` | Slack event ingestion |
| `supabase/functions/daily-digest/` | Digest generation, `/digest`, and cron endpoint |
| `mcp-server/` | Local stdio MCP server |
| `scripts/` | Optional Obsidian export and wiki compilation |
| `.env.example` | Configuration template with no secrets |
| `slack-app-manifest.example.yaml` | Slack app configuration reference |

## Privacy Model

This repository contains application code only. User data lives in the user's
Supabase project. Secrets belong in `.env.local`, Supabase secrets, and the MCP
client's environment configuration; those files and values must never be shared
or committed.
