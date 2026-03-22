-- Projects table
CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  status      text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  goals       text,
  constraints text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Decisions table
CREATE TABLE project_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  summary     text NOT NULL,
  rationale   text,
  made_at     timestamptz DEFAULT now(),
  source      text DEFAULT 'slack' CHECK (source IN ('slack', 'manual', 'ai-session'))
);

-- Link thoughts to projects
ALTER TABLE thoughts
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- Index for thought lookups by project
CREATE INDEX thoughts_project_id_idx ON thoughts(project_id);

-- Auto-update updated_at on projects
CREATE OR REPLACE FUNCTION update_project_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_project_updated_at();

-- RPC: get full project context in one call
CREATE OR REPLACE FUNCTION get_project_context(p_slug text)
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'project', row_to_json(p),
    'decisions', COALESCE((
      SELECT jsonb_agg(row_to_json(d) ORDER BY d.made_at DESC)
      FROM project_decisions d WHERE d.project_id = p.id
    ), '[]'::jsonb),
    'recent_thoughts', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT id, raw_text, title, category, next_action, created_at
        FROM thoughts
        WHERE project_id = p.id
        ORDER BY created_at DESC
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  )
  FROM projects p
  WHERE p.slug = p_slug;
$$ LANGUAGE sql;
