ALTER TABLE customers ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE addresses ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE INDEX addresses_customer_idx ON addresses(customer_id,archived);
