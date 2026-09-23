import { z } from "zod";
import { query, transaction } from "./db";
import { cleanHtml } from "./content";
import { StoreError } from "./errors";
import {
  siteContentSchema,
  defaultSiteContent,
  type SiteContent,
} from "../site-content";

export const cmsPreviewCookie = () =>
  `${process.env.AUTH_COOKIE_PREFIX || "innochem"}-cms-preview`;
export async function siteState() {
  const { rows } = await query(
    "SELECT draft,published,version,published_at,updated_at FROM site_content WHERE id=true",
  );
  const row = rows[0];
  return {
    draft: siteContentSchema.parse(row?.draft || defaultSiteContent),
    published: siteContentSchema.parse(row?.published || defaultSiteContent),
    version: row?.version || 0,
    publishedAt: row?.published_at?.toISOString() || null,
  };
}
export async function readSite(draft = false): Promise<SiteContent> {
  const state = await siteState();
  const content = draft ? state.draft : state.published;
  const features = [content.home.hero, content.home.featured];
  const ids = features.flatMap((f) => (f.productId ? [f.productId] : []));
  if (ids.length) {
    const { rows } = await query(
      "SELECT id,slug,image_path,image_alt,name,status FROM products WHERE id=ANY($1::uuid[])",
      [ids],
    );
    for (const feature of features) {
      if (!feature.productId) continue;
      const product = rows.find(
        (p) => p.id === feature.productId && p.status === "active",
      );
      if (!product) {
        feature.enabled = false;
        continue;
      }
      feature.link.href = `/produkt/${product.slug}`;
      if (product.image_path)
        feature.image = {
          path: product.image_path,
          alt: product.image_alt || product.name,
        };
    }
  }
  return content;
}
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["draft", "publish"]),
      version: z.number().int().min(0),
      value: siteContentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      version: z.number().int().min(0),
      revisionId: z.uuid(),
    })
    .strict(),
]);
export async function saveSiteContent(raw: unknown, actor: string) {
  const input = mutationSchema.parse(raw);
  return transaction(async (db) => {
    // Serializes first insert as well as subsequent saves and publication.
    await db.query("SELECT pg_advisory_xact_lock(842615919)");
    const {
      rows: [existing],
    } = await db.query("SELECT * FROM site_content WHERE id=true FOR UPDATE");
    if ((existing?.version || 0) !== input.version)
      throw new StoreError(
        "VERSION_CONFLICT",
        "Treść zmieniła się od otwarcia edytora. Odśwież panel przed zapisem.",
        409,
      );
    let value: SiteContent;
    if (input.action === "restore") {
      const revision = (
        await db.query("SELECT value FROM site_revisions WHERE id=$1", [
          input.revisionId,
        ])
      ).rows[0];
      if (!revision)
        throw new StoreError(
          "NOT_FOUND",
          "Nie znaleziono zapisanej wersji.",
          404,
        );
      value = siteContentSchema.parse(revision.value);
    } else value = input.value;
    for (const page of [
      value.contactPage,
      value.industryPage,
      value.distributorsPage,
    ])
      page.bodyHtml = cleanHtml(page.bodyHtml);
    const images = [
      value.brand.logo,
      value.seo.image,
      value.home.hero.image,
      value.home.hero.background,
      value.home.technology.image,
      value.home.featured.image,
      value.contactPage.image,
      value.industryPage.image,
      value.distributorsPage.image,
    ];
    const defaults = new Set([
      "/hero-olej.png",
      "/tlo-silnik.png",
      "/img/rp-hps-5w30-hd.png",
    ]);
    const paths = [
      ...new Set(
        images.map((i) => i.path).filter((p) => p && !defaults.has(p)),
      ),
    ];
    if (paths.length) {
      const media = await db.query(
        "SELECT path FROM media WHERE path=ANY($1::text[]) AND mime_type LIKE 'image/%'",
        [paths],
      );
      if (media.rowCount !== paths.length)
        throw new StoreError(
          "MEDIA_INVALID",
          "Zdjęcie nie istnieje w bibliotece. Wybierz dostępny plik.",
        );
    }
    const ids = [
      ...new Set(
        [value.home.hero.productId, value.home.featured.productId].filter(
          Boolean,
        ),
      ),
    ];
    if (
      ids.length &&
      (
        await db.query(
          "SELECT id FROM products WHERE id=ANY($1::uuid[]) AND status='active'",
          [ids],
        )
      ).rowCount !== ids.length
    )
      throw new StoreError(
        "PRODUCT_INVALID",
        "Wybierz aktywny produkt do wyróżnienia na stronie.",
      );
    // Keep the first pre-edit version available, too.
    if (!existing)
      await db.query(
        "INSERT INTO site_revisions(value,action,actor_id) VALUES($1,'draft',$2)",
        [JSON.stringify(defaultSiteContent), actor],
      );
    const publish = input.action === "publish";
    const published = publish
      ? value
      : existing?.published || defaultSiteContent;
    const saved = await db.query(
      `INSERT INTO site_content(id,draft,published,version,published_at) VALUES(true,$1,$2,1,CASE WHEN $3 THEN now() ELSE NULL END)
      ON CONFLICT(id) DO UPDATE SET draft=excluded.draft,published=excluded.published,version=site_content.version+1,updated_at=now(),published_at=CASE WHEN $3 THEN now() ELSE site_content.published_at END RETURNING version,published_at`,
      [JSON.stringify(value), JSON.stringify(published), publish],
    );
    await db.query(
      "INSERT INTO site_revisions(value,action,actor_id) VALUES($1,$2,$3)",
      [JSON.stringify(value), input.action, actor],
    );
    await db.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES($1,$2,'site',$3)",
      [
        actor,
        `site.${input.action}`,
        JSON.stringify({
          version: saved.rows[0].version,
          ...(input.action === "restore"
            ? { revisionId: input.revisionId }
            : {}),
        }),
      ],
    );
    return {
      version: saved.rows[0].version,
      value,
      publishedAt: saved.rows[0].published_at?.toISOString() || null,
    };
  });
}
