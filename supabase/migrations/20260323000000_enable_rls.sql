-- Enable RLS on all tables containing personal data.
-- The service role bypasses RLS by default, so edge functions and the MCP
-- server (which both use SUPABASE_SERVICE_ROLE_KEY) are unaffected.
-- The anon key and any other lower-privilege role will be blocked entirely.

ALTER TABLE thoughts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights          ENABLE ROW LEVEL SECURITY;

-- No USING policies needed: with RLS enabled and no permissive policies defined,
-- access defaults to DENY for all non-service roles.
