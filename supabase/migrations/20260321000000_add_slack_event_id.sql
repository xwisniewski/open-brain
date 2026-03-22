ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS slack_event_id text;

ALTER TABLE thoughts
  ADD CONSTRAINT thoughts_slack_event_id_unique UNIQUE (slack_event_id);
