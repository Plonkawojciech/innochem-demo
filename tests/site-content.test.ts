import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, database } from "../lib/server/db";
import { defaultSiteContent, siteContentSchema } from "../lib/site-content";
import {
  siteState,
  saveSiteContent,
  readSite,
} from "../lib/server/site-content";
import { POST as previewPost } from "../app/api/admin/site-preview/route";
import { PUT as adminPut } from "../app/api/admin/[resource]/[[...id]]/route";
import { auth } from "../lib/server/auth";
import { hashPassword } from "better-auth/crypto";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const copy = () => structuredClone(defaultSiteContent);
test("site drafts stay private until publication and revision restore does not replace the published site", async () => {
  const state = await siteState(),
    content = copy();
  content.home.hero.title = "Synthetic unpublished headline";
  content.contactPage.bodyHtml =
    '<p onclick="alert(1)">Synthetic</p><script>alert(1)</script>';
  const saved = await saveSiteContent(
    { action: "draft", version: state.version, value: content },
    "test-admin",
  );
  assert.equal(
    (await readSite()).home.hero.title,
    state.published.home.hero.title,
  );
  assert.equal((await readSite(true)).home.hero.title, content.home.hero.title);
  assert.equal(saved.value.contactPage.bodyHtml, "<p>Synthetic</p>");
  const revision = (
    await query(
      "SELECT id FROM site_revisions WHERE value->'home'->'hero'->>'title'=$1 ORDER BY created_at DESC LIMIT 1",
      [content.home.hero.title],
    )
  ).rows[0].id;
  content.home.hero.title = "Synthetic published headline";
  const published = await saveSiteContent(
    { action: "publish", version: saved.version, value: content },
    "test-admin",
  );
  assert.equal((await readSite()).home.hero.title, content.home.hero.title);
  await saveSiteContent(
    { action: "restore", version: published.version, revisionId: revision },
    "test-admin",
  );
  assert.equal(
    (await readSite()).home.hero.title,
    "Synthetic published headline",
  );
  assert.equal(
    (await readSite(true)).home.hero.title,
    "Synthetic unpublished headline",
  );
});
test("concurrent CMS edits reject stale versions and reject unsafe images and links", async () => {
  const state = await siteState();
  const results = await Promise.allSettled(
    [1, 2].map((i) =>
      saveSiteContent(
        {
          action: "draft",
          version: state.version,
          value: {
            ...copy(),
            brand: { ...defaultSiteContent.brand, name: `Synthetic ${i}` },
          },
        },
        "test-admin",
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "VERSION_CONFLICT",
  );
  for (const href of [
    "javascript:alert(1)",
    "//example.invalid",
    "/%2fexample.invalid",
    "https://example.invalid\n",
  ]) {
    const content = copy();
    content.navigation.main[0].href = href;
    // Ordinary whitespace is trimmed; embedded CR/LF cannot form an unsafe URL.
    if (!href.endsWith("\n"))
      assert.equal(siteContentSchema.safeParse(content).success, false);
  }
  const content = copy();
  content.home.hero.image.path = "/api/admin/export";
  await assert.rejects(
    saveSiteContent(
      {
        action: "publish",
        version: (await siteState()).version,
        value: content,
      },
      "test-admin",
    ),
    { code: "MEDIA_INVALID" },
  );
});
test("featured products follow live slug and gallery changes and disappear when archived", async () => {
  const id = randomUUID();
  await query(
    "INSERT INTO products(id,name,slug,sku,status,price_cents,image_path,image_alt) VALUES($1,'Synthetic oil',$2,'TEST','active',100,'/media/synthetic.png','Synthetic oil')",
    [id, randomUUID()],
  );
  const content = copy();
  content.home.featured.productId = id;
  await saveSiteContent(
    { action: "publish", version: (await siteState()).version, value: content },
    "test-admin",
  );
  await query(
    "UPDATE products SET slug=$2,image_path='/media/replaced.png' WHERE id=$1",
    [id, `changed-${id}`],
  );
  const live = await readSite();
  assert.equal(live.home.featured.link.href, `/produkt/changed-${id}`);
  assert.equal(live.home.featured.image.path, "/media/replaced.png");
  await query("UPDATE products SET status='archived' WHERE id=$1", [id]);
  assert.equal((await readSite()).home.featured.enabled, false);
});
test("only a verified current administrator can save or enable CMS preview; cookie is HttpOnly", async () => {
  const origin = process.env.APP_URL!;
  const request = (
    path: string,
    body: unknown,
    cookie = "",
    requestOrigin = origin,
  ) =>
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        origin: requestOrigin,
        cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await previewPost(request("/api/admin/site-preview", { enabled: true })))
      .status,
    401,
  );
  assert.equal(
    (
      await previewPost(
        request(
          "/api/admin/site-preview",
          { enabled: true },
          "",
          "https://example.invalid",
        ),
      )
    ).status,
    403,
  );
  const id = randomUUID(),
    email = `synthetic-${id}@example.test`,
    password = "Synthetic-only-CMS-test-2026";
  await query(
    "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,'Synthetic editor',$2,true,'admin')",
    [id, email],
  );
  await query(
    'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
    [id, await hashPassword(password)],
  );
  const login = await auth().handler(
    request("/api/auth/sign-in/email", { email, password }),
  );
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const preview = await previewPost(
    request("/api/admin/site-preview", { enabled: true }, cookie),
  );
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("set-cookie") || "", /HttpOnly/i);
  await query("UPDATE auth_user SET role='customer' WHERE id=$1", [id]);
  assert.equal(
    (
      await previewPost(
        request("/api/admin/site-preview", { enabled: true }, cookie),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await adminPut(
        request(
          "/api/admin/site",
          {
            action: "publish",
            version: (await siteState()).version,
            value: copy(),
          },
          cookie,
        ),
        { params: Promise.resolve({ resource: "site" }) },
      )
    ).status,
    403,
  );
});
