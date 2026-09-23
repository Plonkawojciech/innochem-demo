import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, database } from "../lib/server/db";
import { saveSettings, savePage } from "../lib/server/admin";
import { settingsSchema } from "../lib/server/settings";
import { legalSlugs } from "../lib/server/legal";
import { StoreError, createOrder } from "../lib/server/orders";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const actor = "synthetic-legal-admin";
const error = (code: string) => (e: unknown) =>
  e instanceof StoreError && e.code === code;
async function config() {
  const {
    rows: [r],
  } = await query("SELECT value,version FROM settings WHERE key='store'");
  return { value: settingsSchema.parse(r.value), version: r.version };
}
async function documents() {
  for (const slug of legalSlugs)
    await query(
      "INSERT INTO pages(slug,title,body_html,published) VALUES($1,$1,$2,true) ON CONFLICT(slug) DO UPDATE SET body_html=excluded.body_html,published=true,version=pages.version+1",
      [
        slug,
        `<p>Synthetic test document for ${slug}. ` +
          "Synthetic content for isolated test only. ".repeat(8) +
          "</p>",
      ],
    );
}
test("incomplete draft documents cannot become approved terms", async () => {
  const c = await config();
  await assert.rejects(
    saveSettings(
      {
        ...c,
        value: { ...c.value, legalApproved: true, termsVersion: "incomplete" },
      },
      actor,
    ),
    error("LEGAL_INCOMPLETE"),
  );
  await documents();
  await query(
    "UPDATE pages SET body_html='<p>DO UZUPEŁNIENIA</p>' WHERE slug='regulamin'",
  );
  await assert.rejects(
    saveSettings(
      {
        ...c,
        value: { ...c.value, legalApproved: true, termsVersion: "incomplete" },
      },
      actor,
    ),
    error("LEGAL_INCOMPLETE"),
  );
});
test("approved versions are immutable, and editing a legal page closes checkout until reapproval", async () => {
  await documents();
  let c = await config();
  const version = `synthetic-${randomUUID()}`;
  await saveSettings(
    { ...c, value: { ...c.value, legalApproved: true, termsVersion: version } },
    actor,
  );
  const original = (
    await query("SELECT documents FROM legal_versions WHERE version=$1", [
      version,
    ])
  ).rows[0].documents;
  await assert.rejects(
    query("UPDATE legal_versions SET approved_by='someone' WHERE version=$1", [
      version,
    ]),
    /immutable/,
  );
  const {
    rows: [page],
  } = await query("SELECT * FROM pages WHERE slug='regulamin'");
  await savePage(
    {
      version: page.version,
      slug: page.slug,
      title: page.title,
      bodyHtml: page.body_html + "<p>Changed condition.</p>",
      metaDescription: "",
      published: true,
    },
    actor,
    page.id,
  );
  c = await config();
  assert.equal(c.value.legalApproved, false);
  assert.equal(c.value.checkoutEnabled, false);
  assert.deepEqual(
    (
      await query("SELECT documents FROM legal_versions WHERE version=$1", [
        version,
      ])
    ).rows[0].documents,
    original,
  );
  await assert.rejects(
    saveSettings({ ...c, value: { ...c.value, legalApproved: true } }, actor),
    error("LEGAL_VERSION_REUSED"),
  );
  await saveSettings(
    {
      ...c,
      value: { ...c.value, legalApproved: true, termsVersion: version + "-2" },
    },
    actor,
  );
  // Restore safe configuration for other integration suites, without changing historical revisions.
  c = await config();
  await saveSettings(
    {
      ...c,
      value: { ...c.value, legalApproved: false, checkoutEnabled: false },
    },
    actor,
  );
});
