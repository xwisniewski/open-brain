# First-Time Setup

This guide creates a new, empty, independently owned Open Brain deployment. It
does not require access to the original user's database, notes, Slack workspace,
Google account, or local files.

## 1. Prerequisites

Create or install:

- A Supabase account and a new hosted project
- A Slack workspace where you can install an app
- Anthropic and OpenAI API keys
- Node.js 20 or newer
- Supabase CLI
- Git, or a source archive of this application

Google Calendar, Gmail, and Obsidian are optional. Skip them during the first
setup and add them after the core flow works.

## 2. Create Local Configuration

From the repository root:

```bash
cp .env.example .env.local
openssl rand -hex 32
```

Put the generated value in `DIGEST_SECRET`. Fill in:

```dotenv
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
DIGEST_SECRET=...
USER_TIMEZONE=America/Los_Angeles
```

Find the Supabase URL and service-role key in the project's API settings. Treat
the service-role key like a database administrator password.

## 3. Build The Database

Log in, link this checkout to the new Supabase project, and apply the complete
schema:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations create an empty `thoughts` table, pgvector search, projects,
decisions, insights, helper functions, indexes, and deny-by-default RLS.

Do not link this checkout to the original owner's Supabase project. The new
project is the boundary that keeps each user's second brain private.

## 4. Create The Slack App

The reliable setup path is to create an app from scratch at
`https://api.slack.com/apps`.

1. Create an app in the recipient's Slack workspace.
2. Under **OAuth & Permissions**, add bot scopes:
   `channels:history`, `chat:write`, `im:history`, and `im:write`.
3. Install the app to the workspace.
4. Copy the bot token (`xoxb-...`) and signing secret into `.env.local`.
5. Find the recipient's Slack member ID from their profile and set
   `SLACK_USER_ID`.

`slack-app-manifest.example.yaml` is a reference or shortcut. Replace
`YOUR_PROJECT_REF` before using it.

## 5. Configure And Deploy Edge Functions

Set the required production secrets:

```bash
supabase secrets set \
  ANTHROPIC_API_KEY="..." \
  OPENAI_API_KEY="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  SLACK_BOT_TOKEN="xoxb-..." \
  SLACK_SIGNING_SECRET="..." \
  SLACK_USER_ID="..." \
  DIGEST_SECRET="..." \
  USER_TIMEZONE="America/Los_Angeles"

supabase functions deploy ingest-thought --no-verify-jwt
supabase functions deploy daily-digest --no-verify-jwt
```

The functions use `--no-verify-jwt` because Slack does not send a Supabase JWT.
Slack requests are verified with the Slack signing secret. Direct digest calls
are protected by `DIGEST_SECRET`.

## 6. Connect Slack To The Functions

In the Slack app settings:

1. Enable **Event Subscriptions**.
2. Set the request URL to:
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`
3. Subscribe to bot events `message.channels` and `message.im`.
4. Create a `/digest` slash command with request URL:
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-digest`
5. Reinstall the app if Slack asks you to approve changed scopes.
6. Invite the bot to any capture channel, such as `#sb-inbox`.

Test capture by sending the bot a DM. It should reply in a thread with a check
mark and a generated title. Messages from Slack members other than
`SLACK_USER_ID` are ignored.

Test the digest:

```bash
curl -X POST \
  -H "x-digest-secret: YOUR_DIGEST_SECRET" \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-digest
```

## 7. Schedule The Daily Digest

Use any scheduler that can send a POST request with the `x-digest-secret`
header. Schedule the function URL from step 6 at the recipient's preferred
time.

For example, `8:00 AM America/Los_Angeles` is `16:00 UTC` during standard time
and `15:00 UTC` during daylight saving time. Prefer a scheduler that supports
IANA timezones so the time follows daylight saving changes.

The scheduled request must be:

```text
POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-digest
x-digest-secret: YOUR_DIGEST_SECRET
```

## 8. Install The MCP Server

```bash
cd mcp-server
npm ci
npm run build
npm test
```

Add a stdio MCP server to the recipient's MCP client. Use absolute paths and
provide the same recipient-owned credentials:

```json
{
  "mcpServers": {
    "second-brain": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/SecondBrain/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://YOUR_PROJECT_REF.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

Restart the MCP client and test `get_recent_thoughts` or `search_thoughts`.

## 9. Optional Google Context

To include Google Calendar and Gmail in the digest:

1. Create a Google Cloud project owned by the recipient.
2. Enable Google Calendar API and Gmail API.
3. Configure an OAuth consent screen and OAuth client.
4. Authorize read-only Calendar and Gmail scopes and obtain a refresh token.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `GOOGLE_REFRESH_TOKEN` with `supabase secrets set`.
6. Redeploy `daily-digest`.

The digest still works when these variables are absent.

## 10. Optional Obsidian Export

Set `OBSIDIAN_VAULT_PATH` in `.env.local`, then:

```bash
cd scripts
npm ci
npm run export
npm run compile
```

See `OBSIDIAN_GUIDE.md` for the generated vault structure.

## Troubleshooting

- No Slack capture: check the Slack event URL, bot event subscriptions, channel
  invitation, and `supabase functions logs ingest-thought`.
- `Unauthorized` from a manual digest: send the exact `x-digest-secret` value.
- MCP connection fails: use an absolute path, run `npm run build`, and verify all
  four MCP environment variables.
- Search fails: confirm `supabase db push` applied every migration and OpenAI
  embeddings use `text-embedding-3-small` with 1536 dimensions.
- Digest sends no message: at least one thought must exist from the last 24
  hours.
