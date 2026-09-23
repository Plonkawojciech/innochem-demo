CREATE TABLE site_content (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  draft jsonb NOT NULL,
  published jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value jsonb NOT NULL,
  action text NOT NULL CHECK(action IN ('draft','publish','restore')),
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_revisions_created_idx ON site_revisions(created_at DESC);
