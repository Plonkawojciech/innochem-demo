CREATE TABLE payment_sessions (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  provider text NOT NULL CHECK(provider='stripe'),
  provider_session_id text UNIQUE,
  idempotency_key text UNIQUE NOT NULL,
  request jsonb NOT NULL,
  state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','open','processing','paid','expired','failed','review')),
  live_mode boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_sessions_pending_idx ON payment_sessions(last_checked_at NULLS FIRST) WHERE state IN ('open','processing');
CREATE TABLE payment_webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
