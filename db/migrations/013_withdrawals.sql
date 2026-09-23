CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id uuid REFERENCES customers(id),
  idempotency_key uuid UNIQUE NOT NULL,
  request_hash text NOT NULL,
  access_hash text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  purchase_reference text NOT NULL,
  scope text NOT NULL,
  declaration text NOT NULL,
  receipt_text text NOT NULL,
  preview boolean NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_review','closed')),
  internal_note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_status_idx ON withdrawals(status,created_at DESC);
CREATE INDEX withdrawals_customer_idx ON withdrawals(customer_id,created_at DESC);
-- Preview correspondence must never become deliverable by enabling SMTP later.
ALTER TABLE mail_outbox ADD COLUMN preview boolean NOT NULL DEFAULT true;
