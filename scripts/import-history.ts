import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database, transaction } from "../lib/server/db";
type Row = Record<string, string>;
const cents = (value: string) => Math.round(Number(value) * 100);
const date = (value: string) =>
  value && value !== "0000-00-00 00:00:00" ? value : null;
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: tsx scripts/import-history.ts /private/path/legacy-data.json [--apply]",
    );
  const raw = await readFile(source, "utf8");
  const t = (JSON.parse(raw) as { tables: Record<string, Row[]> }).tables;
  const report = {
    customers: t.customer.length,
    addresses: t.address.length,
    detachedAddresses: [] as string[],
    orders: t.orders.length,
    ordersWithoutCustomer: [] as string[],
    items: t.order_detail.length,
    events: t.order_history.length,
    documents: t.invoice_or_bill.length,
    messages: t.message.length,
    lineTotalDifferences: [] as string[],
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
  };
  const addressById = new Map(t.address.map((a) => [a.id_address, a]));
  const countryById = new Map(t.country.map((c) => [c.id_country, c.iso_code]));
  const address = (a: Row | undefined) =>
    a
      ? {
          firstName: a.firstname,
          lastName: a.lastname,
          company: a.company,
          street: [a.address1, a.address2].filter(Boolean).join(", "),
          postalCode: a.postcode,
          city: a.city,
          country: countryById.get(a.id_country) || "",
          phone: a.phone_mobile || a.phone,
          nip: a.vat_number,
        }
      : {};
  const stateNames = new Map(
    t.order_state_lang
      .filter((s) => s.id_lang === "6")
      .map((s) => [s.id_order_state, s.name]),
  );
  for (const order of t.orders) {
    const details = t.order_detail.filter((d) => d.id_order === order.id_order);
    const sum = details.reduce(
      (v, d) =>
        v +
        Math.round(
          Number(d.product_price) * (1 + Number(d.tax_rate) / 100) * 100,
        ) *
          Number(d.product_quantity),
      0,
    );
    if (Math.abs(sum - cents(order.total_products_wt)) > 1)
      report.lineTotalDifferences.push(order.id_order);
  }
  if (report.lineTotalDifferences.length)
    throw new Error(
      "Historical line totals require reconciliation: " +
        report.lineTotalDifferences.join(","),
    );
  if (report.mode === "dry-run") {
    console.log(JSON.stringify(report));
    return;
  }
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(842615914)");
    await db.query("SET LOCAL TIME ZONE 'Europe/Warsaw'");
    const beforeMail = (
      await db.query("SELECT count(*)::int AS n FROM mail_outbox")
    ).rows[0].n;
    const customers = new Map<string, string>();
    for (const c of t.customer) {
      const email = c.email.trim().toLowerCase();
      await db.query(
        `INSERT INTO auth_user(name,email,"emailVerified",role,"createdAt") VALUES($1,$2,false,'customer',COALESCE($3::timestamptz,now())) ON CONFLICT(email) DO NOTHING`,
        [[c.firstname, c.lastname].join(" ").trim(), email, date(c.date_add)],
      );
      const authId = (
        await db.query("SELECT id FROM auth_user WHERE email=$1", [email])
      ).rows[0].id;
      const {
        rows: [customer],
      } = await db.query(
        `INSERT INTO customers(legacy_id,auth_user_id,email,first_name,last_name,source_created_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(legacy_id) DO UPDATE SET email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name RETURNING id`,
        [
          Number(c.id_customer),
          authId,
          email,
          c.firstname,
          c.lastname,
          date(c.date_add),
        ],
      );
      customers.set(c.id_customer, customer.id);
    }
    for (const a of t.address) {
      const customer = customers.get(a.id_customer);
      if (!customer) {
        report.detachedAddresses.push(a.id_address);
        await db.query(
          "INSERT INTO legacy_records(source_table,source_id,data) VALUES('address',$1,$2) ON CONFLICT(source_table,source_id) DO UPDATE SET data=excluded.data",
          [a.id_address, JSON.stringify(a)],
        );
        continue;
      }
      await db.query(
        `INSERT INTO addresses(legacy_id,customer_id,label,data,archived) VALUES($1,$2,$3,$4,$5) ON CONFLICT(legacy_id) DO UPDATE SET data=excluded.data,archived=excluded.archived`,
        [
          Number(a.id_address),
          customer,
          a.alias,
          JSON.stringify(address(a)),
          a.deleted === "1",
        ],
      );
    }
    const productIds = new Map(
      (await db.query("SELECT id,legacy_id FROM products")).rows.map((p) => [
        String(p.legacy_id),
        p.id,
      ]),
    );
    const orderIds = new Map<string, string>();
    for (const o of t.orders) {
      const customer = customers.get(o.id_customer);
      if (!customer) report.ordersWithoutCustomer.push(o.id_order);
      const c = t.customer.find((c) => c.id_customer === o.id_customer);
      const shipping = cents(o.total_shipping);
      const total = cents(o.total_paid);
      const history = t.order_history
        .filter((h) => h.id_order === o.id_order)
        .sort(
          (a, b) =>
            a.date_add.localeCompare(b.date_add) ||
            Number(a.id_order_history) - Number(b.id_order_history),
        );
      const last = history.at(-1);
      const currency = t.currency.find(
        (c) => c.id_currency === o.id_currency,
      )?.iso_code;
      if (!currency) throw new Error("Unknown historical currency");
      const carrier =
        t.carrier.find((c) => c.id_carrier === o.id_carrier)?.name ||
        "Dostawa historyczna";
      const original = { ...o };
      delete original.secure_key;
      const {
        rows: [order],
      } = await db.query(
        `INSERT INTO orders(legacy_id,customer_id,email,buyer,shipping_address,status,payment_method,currency,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,tracking_number,stock_committed,terms_version,source_data,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'legacy',$6,$7,$8,$9,$10,$11,$12,$13,true,'legacy',$14,$15,$16)
        ON CONFLICT(legacy_id) DO UPDATE SET source_data=excluded.source_data RETURNING id`,
        [
          Number(o.id_order),
          customer || null,
          c?.email || "",
          JSON.stringify({
            ...address(addressById.get(o.id_address_invoice)),
            email: c?.email || "",
          }),
          JSON.stringify(address(addressById.get(o.id_address_delivery))),
          o.payment,
          currency,
          total - shipping,
          shipping,
          total,
          `legacy-${o.id_carrier}`,
          carrier,
          o.shipping_number || null,
          JSON.stringify({
            original,
            statusName: last
              ? stateNames.get(last.id_order_state)
              : "Archiwalne",
          }),
          date(o.date_add),
          date(o.date_upd),
        ],
      );
      orderIds.set(o.id_order, order.id);
    }
    for (const d of t.order_detail) {
      const unit = Math.round(
        Number(d.product_price) * (1 + Number(d.tax_rate) / 100) * 100,
      );
      const quantity = Number(d.product_quantity);
      await db.query(
        `INSERT INTO order_items(order_id,product_id,legacy_id,product_name,sku,quantity,unit_price_cents,tax_rate,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(legacy_id) DO NOTHING`,
        [
          orderIds.get(d.id_order),
          productIds.get(d.product_id) || null,
          Number(d.id_order_detail),
          d.product_name,
          d.product_reference,
          quantity,
          unit,
          Number(d.tax_rate),
          unit * quantity,
        ],
      );
    }
    for (const h of t.order_history)
      await db.query(
        `INSERT INTO order_events(order_id,event_key,kind,data,created_at) VALUES($1,$2,'legacy_status',$3,$4) ON CONFLICT(event_key) DO NOTHING`,
        [
          orderIds.get(h.id_order),
          `legacy-history:${h.id_order_history}`,
          JSON.stringify({
            stateId: h.id_order_state,
            stateName: stateNames.get(h.id_order_state) || h.id_order_state,
          }),
          date(h.date_add),
        ],
      );
    for (const [table, key] of [
      ["invoice_or_bill", "id"],
      ["message", "id_message"],
      ["order_detail", "id_order_detail"],
      ["stock_mvt", "id_stock_mvt"],
    ]) {
      for (const [index, row] of (t[table] || []).entries())
        await db.query(
          "INSERT INTO legacy_records(source_table,source_id,data) VALUES($1,$2,$3) ON CONFLICT(source_table,source_id) DO UPDATE SET data=excluded.data",
          [table, row[key] || String(index), JSON.stringify(row)],
        );
    }
    const afterMail = (
      await db.query("SELECT count(*)::int AS n FROM mail_outbox")
    ).rows[0].n;
    if (beforeMail !== afterMail)
      throw new Error("History import unexpectedly generated mail");
    await db.query(
      "INSERT INTO import_runs(source_hash,mode,report) VALUES($1,'history',$2)",
      [createHash("sha256").update(raw).digest("hex"), JSON.stringify(report)],
    );
  });
  console.log(JSON.stringify(report));
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => database().end());
