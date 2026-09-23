CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer UNIQUE,
  parent_id uuid REFERENCES categories(id),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description_html text NOT NULL DEFAULT '',
  visible boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer UNIQUE,
  slug text UNIQUE NOT NULL,
  sku text NOT NULL DEFAULT '',
  name text NOT NULL,
  summary text NOT NULL DEFAULT '',
  description_html text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 23 CHECK(tax_rate BETWEEN 0 AND 100),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= stock),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  sale_mode text NOT NULL DEFAULT 'retail' CHECK (sale_mode IN ('retail','inquiry')),
  image_path text,
  image_alt text NOT NULL DEFAULT '',
  meta_title text NOT NULL DEFAULT '',
  meta_description text NOT NULL DEFAULT '',
  weight_grams integer NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_categories (
  product_id uuid NOT NULL REFERENCES products(id),
  category_id uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY(product_id,category_id)
);
CREATE INDEX product_categories_category_idx ON product_categories(category_id);
CREATE INDEX products_status_idx ON products(status, name);
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_id text NOT NULL,
  source_path text NOT NULL,
  path text UNIQUE NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  alt text NOT NULL DEFAULT '',
  product_id uuid REFERENCES products(id),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system,source_id)
);
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer UNIQUE,
  auth_user_id text UNIQUE,
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  source_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_email_idx ON customers(lower(email));
CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id integer UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  label text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  legacy_id integer UNIQUE,
  customer_id uuid REFERENCES customers(id),
  access_hash text,
  idempotency_key uuid UNIQUE,
  request_hash text,
  email text NOT NULL,
  buyer jsonb NOT NULL,
  shipping_address jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('pending_payment','paid','processing','shipped','completed','cancelled','refunded','payment_review','legacy')),
  payment_method text NOT NULL,
  payment_provider text,
  payment_reference text UNIQUE,
  currency text NOT NULL DEFAULT 'PLN',
  subtotal_cents integer NOT NULL CHECK(subtotal_cents >= 0),
  shipping_cents integer NOT NULL CHECK(shipping_cents >= 0),
  total_cents integer NOT NULL CHECK(total_cents >= 0),
  shipping_method text NOT NULL,
  shipping_label text NOT NULL,
  tracking_number text,
  reservation_expires_at timestamptz,
  stock_committed boolean NOT NULL DEFAULT false,
  terms_version text NOT NULL,
  source_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(total_cents = subtotal_cents + shipping_cents)
);
CREATE INDEX orders_customer_idx ON orders(customer_id,created_at DESC);
CREATE INDEX orders_status_idx ON orders(status,created_at DESC);
CREATE INDEX orders_reservations_idx ON orders(reservation_expires_at) WHERE status='pending_payment';
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  product_id uuid REFERENCES products(id),
  legacy_id integer UNIQUE,
  product_name text NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK(quantity > 0),
  unit_price_cents integer NOT NULL CHECK(unit_price_cents >= 0),
  tax_rate numeric(5,2) NOT NULL,
  total_cents integer NOT NULL CHECK(total_cents >= 0),
  CHECK(total_cents = unit_price_cents * quantity)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  event_key text UNIQUE,
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events(order_id,created_at);
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  order_id uuid REFERENCES orders(id),
  quantity integer NOT NULL,
  reason text NOT NULL,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  price_cents integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_product_idx ON price_history(product_id,recorded_at DESC);
CREATE TABLE inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  subject text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  body_html text NOT NULL,
  meta_description text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  source_system text,
  source_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system,source_id)
);
CREATE TABLE redirects (
  source_path text PRIMARY KEY,
  destination_path text,
  status integer NOT NULL CHECK(status IN (301,308,410)),
  CHECK((status=410 AND destination_path IS NULL) OR (status<>410 AND destination_path LIKE '/%'))
);
CREATE TABLE mail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_pending_idx ON mail_outbox(available_at) WHERE sent_at IS NULL;
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_id text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash text NOT NULL,
  mode text NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
INSERT INTO settings(key,value) VALUES ('store', '{"checkoutEnabled":false,"shippingApproved":false,"legalApproved":false,"termsVersion":"pending","shippingMethods":[],"paymentMethods":[],"bankAccount":"","orderEmail":"sklep@innochem.pl","contactEmail":"kontakt@innochem.pl"}');
