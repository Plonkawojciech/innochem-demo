ALTER TABLE customers ALTER COLUMN auth_user_id TYPE uuid USING auth_user_id::uuid;
ALTER TABLE customers ADD CONSTRAINT customers_auth_user_fk FOREIGN KEY(auth_user_id) REFERENCES auth_user(id);
ALTER TABLE auth_user ALTER COLUMN role SET DEFAULT 'customer';
ALTER TABLE auth_user ADD CONSTRAINT auth_user_role_check CHECK(role IN ('customer','admin'));
CREATE UNIQUE INDEX auth_user_email_normalized_idx ON auth_user(lower(email));
CREATE UNIQUE INDEX auth_account_identity_idx ON auth_account("providerId","accountId");
CREATE TABLE legacy_records (
  source_table text NOT NULL,
  source_id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY(source_table,source_id)
);
