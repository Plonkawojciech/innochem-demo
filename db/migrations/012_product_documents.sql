CREATE TABLE product_documents (
  product_id uuid NOT NULL REFERENCES products(id),
  media_id uuid NOT NULL REFERENCES media(id),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 180),
  archival boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0 CHECK(position>=0),
  source text NOT NULL DEFAULT 'admin',
  PRIMARY KEY(product_id,media_id)
);
CREATE INDEX product_documents_media_idx ON product_documents(media_id);
