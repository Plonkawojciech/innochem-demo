-- Separate, revocable browser consent; the opaque capability stays HttpOnly.
CREATE TABLE analytics_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
ALTER TABLE orders ADD COLUMN ga_client_id text,
  ADD COLUMN ga_session_id text,
  ADD COLUMN analytics_consent_at timestamptz,
  ADD COLUMN analytics_consent_id uuid REFERENCES analytics_consents(id);
CREATE INDEX orders_analytics_consent_idx ON orders(analytics_consent_id);
CREATE TABLE analytics_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  event_type text NOT NULL CHECK(event_type IN ('purchase','refund','order_submitted')),
  destination text NOT NULL DEFAULT 'ga4',
  payload jsonb NOT NULL,
  client_id text,
  session_id text,
  consent_version integer,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,event_type,destination)
);
CREATE INDEX analytics_outbox_pending_idx ON analytics_outbox(next_attempt_at) WHERE status='pending';
