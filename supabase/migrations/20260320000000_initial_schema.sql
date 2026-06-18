CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS thoughts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text    text NOT NULL,
  source      text NOT NULL DEFAULT 'manual',
  thread_id   text,
  category    text NOT NULL DEFAULT 'needs_review' CHECK (
                category IN ('people', 'projects', 'ideas', 'admin', 'needs_review')
              ),
  confidence  double precision,
  title       text NOT NULL,
  next_action text,
  people      text[] NOT NULL DEFAULT '{}',
  topics      text[] NOT NULL DEFAULT '{}',
  embedding   extensions.vector(1536) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thoughts_created_at_idx ON thoughts(created_at DESC);
CREATE INDEX IF NOT EXISTS thoughts_category_idx ON thoughts(category);
CREATE INDEX IF NOT EXISTS thoughts_embedding_idx
  ON thoughts USING hnsw (embedding extensions.vector_cosine_ops);
