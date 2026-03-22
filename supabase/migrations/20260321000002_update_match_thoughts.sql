-- Update match_thoughts to support optional project filter
CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  raw_text text,
  title text,
  category text,
  topics text[],
  next_action text,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql AS $$
  SELECT
    t.id,
    t.raw_text,
    t.title,
    t.category,
    t.topics,
    t.next_action,
    t.created_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM thoughts t
  WHERE
    (filter_project_id IS NULL OR t.project_id = filter_project_id)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
$$;
