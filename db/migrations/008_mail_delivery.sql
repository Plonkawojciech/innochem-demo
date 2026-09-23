ALTER TABLE mail_outbox ADD COLUMN delivery_state text NOT NULL DEFAULT 'queued'
CHECK(delivery_state IN ('queued','sending','sent','failed','uncertain'));
UPDATE mail_outbox SET delivery_state='sent' WHERE sent_at IS NOT NULL;
CREATE INDEX mail_outbox_delivery_idx ON mail_outbox(delivery_state,available_at) WHERE sent_at IS NULL;
