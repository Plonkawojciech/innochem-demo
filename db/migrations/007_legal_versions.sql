CREATE TABLE legal_versions (
  version text PRIMARY KEY,
  documents jsonb NOT NULL,
  commerce jsonb NOT NULL,
  content_hash text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION prevent_legal_revision_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Approved legal revisions are immutable; create a new version'; END;
$$;
CREATE TRIGGER legal_versions_immutable BEFORE UPDATE OR DELETE ON legal_versions
FOR EACH ROW EXECUTE FUNCTION prevent_legal_revision_change();
ALTER TABLE orders ADD COLUMN legal_version text REFERENCES legal_versions(version);
