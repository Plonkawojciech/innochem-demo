ALTER TABLE categories ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE inquiries ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE inquiries ADD COLUMN internal_note text NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE INDEX media_product_idx ON media(product_id,position);
CREATE INDEX inquiries_status_idx ON inquiries(status,created_at DESC);
