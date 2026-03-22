CREATE TABLE insights (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN (
                'suggested_project',
                'recurring_action',
                'stale_action',
                'recurring_person'
              )),
  title       text NOT NULL,
  detail      jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'dismissed')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

CREATE INDEX insights_status_detected_idx ON insights(status, detected_at DESC);
CREATE INDEX insights_type_title_idx ON insights(type, title);

-- Prevents re-inserting the same insight within 24h
CREATE OR REPLACE FUNCTION insight_exists(p_type text, p_title text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM insights
    WHERE type = p_type AND title = p_title
      AND detected_at > now() - interval '24 hours'
  );
$$ LANGUAGE sql;

-- Pattern detection helpers (pure SQL, called by daily-digest)

-- Topics from unlinked thoughts appearing 3+ times in window
CREATE OR REPLACE FUNCTION detect_suggested_projects(since timestamptz)
RETURNS TABLE(topic text, count bigint, thought_ids uuid[]) AS $$
  SELECT
    unnested.topic,
    COUNT(DISTINCT t.id) AS count,
    ARRAY_AGG(DISTINCT t.id) AS thought_ids
  FROM thoughts t
  CROSS JOIN LATERAL unnest(t.topics) AS unnested(topic)
  WHERE t.project_id IS NULL
    AND t.created_at >= since
  GROUP BY unnested.topic
  HAVING COUNT(DISTINCT t.id) >= 3
  ORDER BY count DESC;
$$ LANGUAGE sql;

-- Same next_action text appearing 2+ times in window
CREATE OR REPLACE FUNCTION detect_recurring_actions(since timestamptz)
RETURNS TABLE(action text, count bigint, thought_ids uuid[]) AS $$
  SELECT
    lower(trim(t.next_action)) AS action,
    COUNT(*) AS count,
    ARRAY_AGG(t.id) AS thought_ids
  FROM thoughts t
  WHERE t.next_action IS NOT NULL
    AND t.created_at >= since
  GROUP BY lower(trim(t.next_action))
  HAVING COUNT(*) >= 2
  ORDER BY count DESC;
$$ LANGUAGE sql;

-- Thoughts with next_action older than older_than but newer than newer_than
CREATE OR REPLACE FUNCTION detect_stale_actions(older_than timestamptz, newer_than timestamptz)
RETURNS TABLE(action text, days_old int, thought_id uuid) AS $$
  SELECT
    t.next_action AS action,
    EXTRACT(DAY FROM now() - t.created_at)::int AS days_old,
    t.id AS thought_id
  FROM thoughts t
  WHERE t.next_action IS NOT NULL
    AND t.created_at < older_than
    AND t.created_at > newer_than
  ORDER BY t.created_at ASC;
$$ LANGUAGE sql;

-- People mentioned 3+ times in window
CREATE OR REPLACE FUNCTION detect_recurring_people(since timestamptz)
RETURNS TABLE(person text, count bigint, thought_ids uuid[]) AS $$
  SELECT
    unnested.person,
    COUNT(DISTINCT t.id) AS count,
    ARRAY_AGG(DISTINCT t.id) AS thought_ids
  FROM thoughts t
  CROSS JOIN LATERAL unnest(t.people) AS unnested(person)
  WHERE t.created_at >= since
  GROUP BY unnested.person
  HAVING COUNT(DISTINCT t.id) >= 3
  ORDER BY count DESC;
$$ LANGUAGE sql;
