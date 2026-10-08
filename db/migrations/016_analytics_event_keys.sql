-- Preserve all existing rows. Each recorded refund can now have its own event.
ALTER TABLE analytics_outbox ADD COLUMN event_key text NOT NULL DEFAULT 'singleton';
CREATE UNIQUE INDEX analytics_outbox_event_identity_idx ON analytics_outbox(order_id,event_type,destination,event_key);
ALTER TABLE analytics_outbox DROP CONSTRAINT analytics_outbox_order_id_event_type_destination_key;
