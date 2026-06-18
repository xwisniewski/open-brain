# Handoff Checklist

## Recommended Handoff Model

Give the recipient a clean copy of the application code and let them deploy it
into accounts they own. Do not give them access to your existing Supabase
project, Slack app, Google OAuth client, AI keys, `.env.local`, Obsidian vault,
or MCP client configuration.

They do need the application source, either through a repository or a source
archive. The source is the product; it contains no personal notes or secrets
when the checklist below is followed.

If the recipient only wants Slack capture and digests, they do not need to keep
the source after you help deploy it. MCP retrieval and Obsidian features run
locally, so those features require the clean application package on their
computer.

## Before Sharing

1. Confirm `.env`, `.env.local`, `client_secret_*.json`, `node_modules`, build
   output, and Supabase temporary files are excluded by `.gitignore`.
2. Run a secret scan or inspect the repository history before publishing it.
   The current Git history contains an old personal Slack member ID, so use a
   clean source archive/new repository or rewrite history before making it
   public.
3. Remove personal IDs, URLs, paths, screenshots, sample notes, and exported
   data from the shared copy.
4. Share only source code and documentation.
5. Have the recipient follow `docs/FIRST_TIME_SETUP.md`.
6. Verify capture, `/digest`, scheduled digest, semantic search, and RLS in the
   recipient's deployment.

Create an allow-listed source bundle that excludes Git history, secrets,
personal planning files, installed dependencies, and generated output:

```bash
./scripts/create-handoff-package.sh
```

Share the resulting `open-brain-handoff.tar.gz`. Inspect its contents before
sending it:

```bash
tar -tzf open-brain-handoff.tar.gz
```

## If Transferring The Existing Deployment Instead

This is possible, but it transfers the data and operational history too. Use it
only when the recipient should inherit the existing second brain.

1. Export or delete any personal data that should not transfer.
2. Transfer Supabase organization/project ownership.
3. Transfer or recreate the Slack app in the recipient's workspace.
4. Replace every AI, Slack, Google, Supabase, and digest secret.
5. Replace `SLACK_USER_ID` and `USER_TIMEZONE`.
6. Replace the scheduler and MCP client configuration.
7. Revoke the former owner's credentials and access.

For a new user, a fresh deployment is simpler and safer.
