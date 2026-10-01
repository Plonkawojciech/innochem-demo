CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL DEFAULT 'apaczka',
  provider_order_id text NOT NULL,
  service_id text NOT NULL,
  service_name text NOT NULL,
  waybill_number text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','cancelled')),
  parcel jsonb NOT NULL,
  cod_cents integer,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE(provider, provider_order_id)
);
CREATE INDEX shipments_order_idx ON shipments(order_id);
CREATE UNIQUE INDEX shipments_active_order_idx ON shipments(order_id) WHERE status='created';
