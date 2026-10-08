-- Do not guess which provider environment created a historical shipment.
ALTER TABLE shipments ADD COLUMN mode text NOT NULL DEFAULT 'unknown'
  CHECK (mode IN ('sandbox','live','unknown'));
CREATE UNIQUE INDEX shipments_provider_mode_identity_idx ON shipments(provider,mode,provider_order_id);
ALTER TABLE shipments DROP CONSTRAINT shipments_provider_provider_order_id_key;
DROP INDEX shipments_active_order_idx;
CREATE UNIQUE INDEX shipments_active_order_mode_idx ON shipments(order_id,mode) WHERE status='created';
-- Purchase and submission remain singleton events at the database boundary.
ALTER TABLE analytics_outbox ADD CONSTRAINT analytics_outbox_singleton_check
  CHECK (event_type='refund' OR event_key='singleton');
