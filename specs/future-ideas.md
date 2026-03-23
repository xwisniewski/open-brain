# Future Ideas & Specs

Captured: 2026-03-23

---

## 1. Fix the Slack Capture Flow (UX Pain Point)

**Problem:** The current flow is split across two Slack channels — you type a thought in `#sb-inbox` and have to switch to another tab/channel to see any response or confirmation. This context-switching adds enough friction that you might avoid capturing thoughts in the moment.

**Goal:** Make the capture feel instant and in-place — ideally a single message in, acknowledgement back, no tab-switching.

### Options

**Option A: Slack Bot with DM interface**
- Replace the webhook with a proper Slack bot (using Bolt SDK or Slack's socket mode)
- You DM the bot directly, it responds in-thread with a confirmation + the classification result
- `You: "Need to follow up with Sarah about the Q2 budget"`
- `Bot: "Got it. [people] → 'Follow up with Sarah re Q2 budget' | Next action: send message ✓"`
- Bonus: the bot could respond to natural language commands like "what did I capture this week?" or "show me stale actions"

**Option B: Slack slash command**
- `/brain <thought>` from anywhere in Slack → sends to ingest → ephemeral reply with classification
- No dedicated channel needed, works from any context

**Option C: Slack modal (shortcut)**
- Add a global Slack shortcut (⚡ menu) that opens a modal form
- Fields: thought text, optional project tag, optional category override
- Submits inline, returns a toast confirmation
- Best for structured capture when you want to be deliberate

**Recommended:** Option A (DM bot) as the primary interface + Option B (slash command) as a quick-fire fallback. This means you capture where you are and get instant feedback.

### Implementation Notes
- Needs: Slack app with bot token + socket mode or Events API
- The current edge function becomes the processing backend; the bot is just a new front door
- Bot can also surface `get_insights` output on demand via DM commands
- Rough complexity: medium — mostly Slack API plumbing, the ingest logic stays the same

---

## 2. Obsidian / Note App Integration

**Problem:** The second brain currently only captures via Slack. But a lot of thinking happens in notes — meeting notes, journal entries, brainstorms in Obsidian, Bear, Notion, Apple Notes, etc. These are rich sources that never make it in.

**Goal:** Pipe notes (or excerpts) into the second brain without manual copy-paste.

### Options

**Option A: Obsidian plugin (write a custom plugin)**
- A small Obsidian plugin that adds a "Send to Second Brain" command
- Highlights text → runs command → POSTs to ingest edge function
- Can also do whole-note ingestion with a frontmatter flag (`second-brain: true`)
- Full control, works offline-first

**Option B: Obsidian folder sync (file watcher)**
- Designate a folder in your Obsidian vault (e.g., `_inbox/`)
- A local daemon (Node script or launchd job) watches for new `.md` files
- On file creation/change, strips frontmatter and POSTs content to ingest
- Low friction: just drop a note in the folder
- Works with any note app that can save to a folder (Bear export, Drafts, etc.)

**Option C: Use Obsidian's existing community plugins**
- Some community plugins (like "Obsidian to Anki" patterns) can POST to webhooks
- You'd configure it to hit your ingest edge function URL
- Least code but depends on plugin availability and maintenance

**Option D: Apple Shortcuts / Raycast**
- A Raycast extension or Apple Shortcut that takes selected text from any app and POSTs to ingest
- System-wide capture from any app — not just Obsidian
- Raycast approach: write a small extension, bind it to a hotkey
- This is essentially a universal clipboard capture layer

**Recommended:** Option B (folder watcher) for Obsidian bulk import + Option D (Raycast/Shortcuts) for system-wide on-demand capture. These two cover 90% of the use case with low ongoing maintenance.

### Implementation Notes
- File watcher: Node script using `chokidar`, runs as a launchd agent on macOS
- Content chunking needed for long notes — split by heading or paragraph, embed each chunk
- Add a `source` field to the thoughts table (`slack`, `obsidian`, `raycast`, `manual`) for provenance
- Dedup by content hash to avoid re-ingesting edited notes repeatedly

---

## 3. Beyond Productivity — Expanding What the Brain Tracks

**Problem:** The current schema is productivity-oriented: `category` is `people | projects | ideas | admin | needs_review`, and the system is tuned toward actions, next steps, and project context. But a personal second brain should be able to hold a much wider range of thought types.

**Goal:** Make the system useful for capturing and retrieving *any* kind of thought — not just work tasks.

### What Else Could Live Here

- **Books / articles read** — key quotes, reactions, what you'd recommend it for
- **Conversations worth remembering** — what someone said that stuck with you
- **Personal reflections** — things you noticed about yourself, decisions you're wrestling with
- **Things you want to try** — restaurants, travel ideas, hobbies, experiments
- **Reference facts** — things you keep having to look up
- **Creative fragments** — half-ideas, metaphors, bits of writing
- **Emotional snapshots** — how you felt at a moment in time, what was going on

### Schema Changes Needed

**New categories to add:**
```
learning      -- book notes, article takeaways, concepts
personal      -- reflections, values, life decisions
reference     -- facts, how-tos, things to remember
creative      -- half-ideas, metaphors, creative fragments
want-to-try   -- places, experiences, experiments
```

**New optional fields on `thoughts`:**
- `mood` (optional enum or free text) — for personal/emotional entries
- `source_title` / `source_url` — for book/article notes
- `is_private` (bool, default false) — so you can flag entries that shouldn't surface in AI digest

**New capture conventions for Slack/bot:**
- Prefix shortcuts: `[book] Just finished Thinking Fast and Slow — ...`
- Or natural language that the classifier learns to map to new categories

### What Changes in the AI Layer

- Claude's classification prompt needs to know about new categories
- Digest could have a "personal" section separate from work patterns
- `get_insights` could surface personal patterns too — "you've mentioned loneliness 4 times this month"
- Search across all life areas, not just work projects

### Recommended Approach
- Add new categories incrementally — start with `learning` and `personal` since those are highest value
- Don't redesign the schema all at once; just expand the `category` enum and update the classifier prompt
- Add `is_private` column so personal entries can be excluded from digests if desired

---

## 4. Google Calendar + Gmail Integration

**Problem:** Your second brain has no awareness of what's on your calendar or in your inbox. A lot of context lives there — upcoming meetings, email threads that require action, commitments you made over email.

**Goal:** Let the second brain see (and optionally capture from) your calendar and email.

### Gmail

**Already available:** The Gmail MCP server is already wired into Claude Code sessions (`gmail_search_messages`, `gmail_read_thread`, etc.). This means in any Claude conversation you can already query your email.

**What's missing:** The MCP server for your *second brain* doesn't have Gmail tools yet. Adding them would let Claude surface relevant emails when you ask about a project, person, or topic.

**Options:**

**Option A: Add `search_gmail` tool to MCP server**
- Wire Gmail API directly into `mcp-server/index.ts`
- Needs a Google OAuth refresh token stored as an env var
- Tool: `search_gmail(query, max_results)` — returns subject, sender, date, snippet
- Optionally: `get_email_thread(thread_id)` for full context

**Option B: Scheduled email ingestion**
- Daily edge function that pulls unread/flagged emails matching certain criteria
- Ingests them as thoughts (category: `admin` or new `email` category)
- Then they're searchable via semantic search like any other thought
- Risk: inbox noise — needs smart filtering (e.g., only emails you're explicitly CC'd on, or starred)

**Recommended:** Option A as an MCP tool (read-only, on-demand) + no auto-ingestion unless you explicitly flag an email in Gmail.

### Google Calendar

**Not yet wired in anywhere.** Requires Google Cloud project + Calendar API enabled + OAuth credentials.

**Options:**

**Option A: Add `get_calendar_events` tool to MCP server**
- `get_calendar_events(days_ahead: 7)` → returns events with title, time, attendees, description
- Lets Claude see what's coming up when you ask "what do I have this week?"
- Also enables: "what meetings do I have with Sarah?" cross-referenced with thoughts about Sarah

**Option B: Ingest calendar events as thoughts**
- Edge function syncs upcoming events into the thoughts table
- Category: `admin`, topics derived from attendees/description
- Enables semantic search: "when did I last meet with the design team?"
- Useful for retrospective pattern detection too

**Option C: Daily digest includes calendar preview**
- Modify `daily-digest` to pull tomorrow's/this week's events from Calendar API
- Add a "Coming up" section at the top of the daily Slack DM
- Zero new DB schema needed

**Recommended:** Option A (MCP tool) first — low complexity, high value. Option C (digest preview) is a quick win add-on. Option B is powerful but adds ingestion noise.

### Implementation Steps (when ready to build)
1. Create Google Cloud project, enable Calendar API + Gmail API
2. Set up OAuth 2.0 credentials (Desktop app flow to get initial refresh token)
3. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` as Supabase secrets
4. Add `googleapis` npm package to `mcp-server/`
5. Add `get_calendar_events` and `search_gmail` tools to `mcp-server/index.ts`
6. Optionally extend daily-digest edge function to prepend calendar preview

---

## 5. Security Hardening

**Concern:** This system holds your most personal thoughts — things you'd only say to yourself. A breach wouldn't just expose data, it would expose your inner life. It deserves a higher security bar than a typical side project.

### What the Threat Model Actually Is

You're not defending against a nation-state. The realistic threats are:
- A leaked API key or Supabase service role key giving a stranger read access to your entire thoughts table
- Supabase edge function logs being accessed by someone who gains access to your Supabase dashboard
- Your local machine being compromised, exposing the MCP server's env vars
- A misconfigured Supabase RLS policy (or no RLS at all) leaving data open to anyone who guesses your project URL
- Adding Google OAuth credentials later and not storing them safely

### What's Already Good

The code has some things right:
- **Slack signature verification** is correctly implemented using HMAC-SHA256 with a 5-minute replay window — the ingest endpoint won't accept forged requests
- **Secrets are in environment variables**, not hardcoded
- **Deduplication by `event_id`** limits some abuse surface
- **`--no-verify-jwt` is intentional** and documented — Slack webhooks can't send JWTs, so this is the right trade-off as long as signature verification is solid

### Current Risks (Found in the Code)

**High: Thoughts logged in plaintext to edge function logs**

In `ingest-thought/index.ts`:
```ts
console.log("Body:", rawBody.slice(0, 200));          // raw Slack payload
console.log("Processing message:", rawText.slice(0, 100), ...);  // your thought
console.log("Claude response:", claudeData.content[0].text);     // classified content
```
Supabase edge function logs are stored and visible in the Supabase dashboard. Anyone with dashboard access (or anyone who gets your Supabase login) can read your thoughts via logs, even without touching the DB. This is the single biggest practical risk.

**High: MCP server uses service role key**

`mcp-server/index.ts` connects with `SUPABASE_SERVICE_ROLE_KEY` — the master key that bypasses all Row Level Security. If this env var leaks (e.g., your shell history, a dotfile accidentally committed, a process listing tool), an attacker has unrestricted read/write access to your entire database.

**Medium: No Row Level Security (RLS) confirmed**

Unknown whether RLS policies are in place. Without RLS, the anon key is effectively as powerful as the service role key for reads. Anyone who finds your Supabase URL + anon key (both are typically in client-side code) can query all thoughts.

**Medium: HMAC signature logged on mismatch**

```ts
console.error("Signature mismatch", { computed, received: signature });
```
This logs the actual HMAC values. The signatures are per-request so this isn't immediately exploitable, but it's unnecessary noise in logs that could aid an attacker understanding your request structure.

**Low: Supabase project ref is in memory files**

The project ref `kgduusaefigsywsddwvh` appears in the MEMORY.md file. The ref alone isn't dangerous, but it means someone who finds these files can immediately identify your Supabase project and probe it. Worth being aware of.

### Recommended Fixes

**1. Strip personal content from edge function logs (do this first)**

Remove or redact the log lines that output thought content. Replace with non-identifying metadata only:
```ts
// Instead of: console.log("Body:", rawBody.slice(0, 200))
console.log("Received Slack event, body length:", rawBody.length)

// Instead of: console.log("Processing message:", rawText.slice(0, 100), ...)
console.log("Processing event_id:", eventId, "text length:", rawText.length)

// Remove entirely: console.log("Claude response:", ...)
console.log("Claude classification complete")
```

**2. Enable Row Level Security on the thoughts table**

In Supabase SQL editor, enable RLS and add a policy that only allows access via the service role (or an authenticated user). This means even if the anon key leaks, the data is not accessible:
```sql
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
-- Allow only service role (bypasses RLS by default, so this effectively blocks anon)
-- Or if you add auth later:
CREATE POLICY "owner_only" ON thoughts FOR ALL USING (auth.role() = 'service_role');
```
Same for `projects`, `project_decisions`, `insights` tables.

**3. Create a read-only DB role for the MCP server**

The MCP server only needs to read data and call RPCs — it never needs to delete thoughts or drop tables. Create a restricted Postgres role and use that connection string in the MCP server instead of the service role key:
```sql
CREATE ROLE mcp_reader;
GRANT SELECT ON thoughts, projects, project_decisions, insights TO mcp_reader;
GRANT EXECUTE ON FUNCTION match_thoughts, get_project_context TO mcp_reader;
```
This limits blast radius if the MCP server env var leaks.

**4. Audit what's in your `.env` / shell config**

Run through:
- Is `SUPABASE_SERVICE_ROLE_KEY` in any dotfile that's version controlled?
- Is it in your shell history (`~/.zsh_history`)?
- Is the `mcp-server/.env` file in `.gitignore`?

Check: `git log --all --full-diff -p -- "*.env" "**/.env"` to make sure no secrets were ever committed.

**5. Rotate keys periodically**

Supabase lets you rotate the service role JWT. Google OAuth refresh tokens can be revoked. Set a reminder to rotate these every 6-12 months or immediately if you ever suspect exposure.

**6. Lock down Supabase dashboard access**

Go to Supabase → Settings → Team. Make sure only your account has access. Enable 2FA on your Supabase account if you haven't already — this is what protects the logs.

### When You Add Google OAuth (Calendar / Gmail)

Google refresh tokens are long-lived credentials that give persistent access to your email and calendar. Handle them carefully:
- Store them as Supabase secrets (encrypted at rest), not in `.env` files or shell config
- Request the minimum OAuth scopes needed (`calendar.readonly`, `gmail.readonly` — never `gmail.modify` unless you need it)
- Log zero email/event content in edge function logs — same rule as thoughts
- Set up a Google Cloud alert for unusual API quota usage (free) so you'd notice if a token was stolen and being used

### Longer-Term: Encryption at Rest for Thoughts

Supabase encrypts the underlying disk (AES-256), but the data is readable in plaintext by anyone with DB access. If you want stronger guarantees:
- Encrypt the `raw_text` field with a key you control before inserting
- Decrypt at read time in the MCP server
- This means even a full DB dump reveals nothing without your key
- Trade-off: you lose the ability to run SQL queries on the content directly; semantic search still works because embeddings are stored separately

This is probably overkill for now but worth knowing is possible.

---

## Priority Order (suggested)

| Idea | Value | Effort | Do first? |
|---|---|---|---|
| **Security: strip logs** | Critical | Very Low | Yes — do this immediately |
| **Security: enable RLS** | Critical | Low | Yes — do this immediately |
| Fix Slack flow (DM bot) | High | Medium | Yes — removes daily friction |
| Google Calendar MCP tool | High | Medium | Yes — quick win, no schema changes |
| Expand categories (learning, personal) | High | Low | Yes — just an enum + prompt change |
| Security: read-only MCP DB role | Medium | Low | Before adding Google credentials |
| Gmail MCP tool | Medium | Medium | After Calendar |
| Obsidian folder watcher | Medium | Low | Yes if you use Obsidian regularly |
| Raycast capture | Medium | Low | Good complement to Slack bot |
| Email ingestion | Low | High | Later — inbox noise risk |
| Calendar event ingestion | Low | Medium | Later — after MCP tool proves useful |
| Security: encrypt raw_text at rest | Low | High | Only if threat model escalates |
