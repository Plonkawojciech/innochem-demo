import { z } from "zod";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { cleanHtml } from "./content";
import { settingsSchema } from "./settings";
import { StoreError } from "./orders";
import { approveLegalVersion, legalSlugs } from "./legal";

const name = z.string().trim().min(1).max(180);
const slug = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const version = z.number().int().positive();
const uuid = z.uuid();
export const productInput = z
  .object({
    version: version.optional(),
    name,
    slug,
    sku: z.string().trim().max(100),
    summary: z.string().trim().max(2000),
    descriptionHtml: z.string().max(100000),
    priceCents: z.number().int().min(0).max(10000000),
    taxRate: z.number().min(0).max(100),
    stock: z.number().int().min(0).max(1000000),
    status: z.enum(["draft", "active", "archived"]),
    saleMode: z.enum(["retail", "inquiry"]),
    weightGrams: z.number().int().min(0).max(1000000),
    metaTitle: z.string().trim().max(180),
    metaDescription: z.string().trim().max(320),
    categoryIds: z.array(uuid).max(50),
    mediaIds: z.array(uuid).max(50),
    imageAlt: z.string().trim().max(300),
    documents: z
      .array(
        z
          .object({
            mediaId: uuid,
            label: z.string().trim().min(1).max(180),
            archival: z.boolean(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict()
  .refine(
    (p) => p.status !== "active" || p.saleMode !== "retail" || p.priceCents > 0,
    "Aktywny produkt detaliczny musi mieć cenę.",
  )
  .refine(
    (p) =>
      new Set(p.mediaIds).size === p.mediaIds.length &&
      new Set(p.categoryIds).size === p.categoryIds.length &&
      (!p.documents ||
        new Set(p.documents.map((d) => d.mediaId)).size === p.documents.length),
    "Lista zawiera powtórzenia.",
  );

export async function audit(
  db: PoolClient,
  actor: string,
  action: string,
  entity: string,
  data: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES($1,$2,$3,$4)",
    [actor, action, entity, JSON.stringify(data)],
  );
}
function conflict() {
  return new StoreError(
    "VERSION_CONFLICT",
    "Dane zmieniły się od otwarcia formularza. Odśwież stronę i sprawdź aktualne wartości.",
    409,
  );
}
export async function saveProduct(raw: unknown, actor: string, id?: string) {
  if (id) uuid.parse(id);
  const p = productInput.parse(raw);
  return transaction(async (db) => {
    const previous = id
      ? (await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [id]))
          .rows[0]
      : null;
    if (id && !previous)
      throw new StoreError("NOT_FOUND", "Nie znaleziono produktu.", 404);
    if (previous && previous.version !== p.version) throw conflict();
    if (previous && p.stock < previous.reserved)
      throw new StoreError(
        "RESERVED_STOCK",
        `Zarezerwowano ${previous.reserved} szt. Stan całkowity nie może być niższy.`,
        409,
      );
    const cats = await db.query(
      "SELECT id FROM categories WHERE id=ANY($1::uuid[])",
      [p.categoryIds],
    );
    if (cats.rowCount !== p.categoryIds.length)
      throw new StoreError(
        "CATEGORY_MISSING",
        "Wybrana kategoria nie istnieje.",
      );
    const images = await db.query(
      "SELECT id,path,product_id,mime_type FROM media WHERE id=ANY($1::uuid[]) FOR UPDATE",
      [p.mediaIds],
    );
    if (
      images.rowCount !== p.mediaIds.length ||
      images.rows.some(
        (m) =>
          !m.mime_type.startsWith("image/") ||
          (m.product_id && m.product_id !== id),
      )
    )
      throw new StoreError(
        "MEDIA_INVALID",
        "Zdjęcie nie istnieje lub należy do innego produktu.",
      );
    if (p.documents) {
      const files = await db.query(
        "SELECT id,mime_type FROM media WHERE id=ANY($1::uuid[])",
        [p.documents.map((d) => d.mediaId)],
      );
      if (
        files.rowCount !== p.documents.length ||
        files.rows.some(
          (m) =>
            ![
              "application/pdf",
              "application/msword",
              "application/vnd.oasis.opendocument.text",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ].includes(m.mime_type),
        )
      )
        throw new StoreError(
          "DOCUMENT_INVALID",
          "Wybierz istniejący dokument PDF, DOC, DOCX lub ODT.",
        );
    }
    const imagePath =
      images.rows.find((m) => m.id === p.mediaIds[0])?.path || null;
    const values = [
      p.name,
      p.slug,
      p.sku,
      p.summary,
      cleanHtml(p.descriptionHtml),
      p.priceCents,
      p.taxRate,
      p.stock,
      p.status,
      p.saleMode,
      p.weightGrams,
      p.metaTitle,
      p.metaDescription,
      imagePath,
      p.imageAlt,
    ];
    const saved = id
      ? await db.query(
          `UPDATE products SET name=$1,slug=$2,sku=$3,summary=$4,description_html=$5,price_cents=$6,tax_rate=$7,stock=$8,status=$9,sale_mode=$10,weight_grams=$11,meta_title=$12,meta_description=$13,image_path=$14,image_alt=$15,version=version+1,updated_at=now() WHERE id=$16 RETURNING id,version`,
          [...values, id],
        )
      : await db.query(
          `INSERT INTO products(name,slug,sku,summary,description_html,price_cents,tax_rate,stock,status,sale_mode,weight_grams,meta_title,meta_description,image_path,image_alt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,version`,
          values,
        );
    const productId = saved.rows[0].id;
    await db.query("UPDATE redirects SET active=false WHERE source_path=$1", [
      `/produkt/${p.slug}`,
    ]);
    if (previous && previous.slug !== p.slug)
      await db.query(
        "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,301) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=301,active=true",
        [`/produkt/${previous.slug}`, `/produkt/${p.slug}`],
      );
    if (!previous || previous.price_cents !== p.priceCents)
      await db.query(
        "INSERT INTO price_history(product_id,price_cents) VALUES($1,$2)",
        [productId, p.priceCents],
      );
    const stockDelta = p.stock - (previous?.stock || 0);
    if (stockDelta)
      await db.query(
        "INSERT INTO stock_movements(product_id,quantity,reason,actor_id) VALUES($1,$2,'admin_adjustment',$3)",
        [productId, stockDelta, actor],
      );
    await db.query("DELETE FROM product_categories WHERE product_id=$1", [
      productId,
    ]);
    for (const categoryId of p.categoryIds)
      await db.query(
        "INSERT INTO product_categories(product_id,category_id) VALUES($1,$2)",
        [productId, categoryId],
      );
    await db.query(
      "UPDATE media SET product_id=NULL WHERE product_id=$1 AND NOT(id=ANY($2::uuid[]))",
      [productId, p.mediaIds],
    );
    for (const [index, mediaId] of p.mediaIds.entries())
      await db.query("UPDATE media SET product_id=$1,position=$2 WHERE id=$3", [
        productId,
        index,
        mediaId,
      ]);
    if (p.documents) {
      const previousDocuments = (
        await db.query(
          "SELECT media_id,label,archival FROM product_documents WHERE product_id=$1 ORDER BY position,media_id",
          [productId],
        )
      ).rows;
      await db.query("DELETE FROM product_documents WHERE product_id=$1", [
        productId,
      ]);
      for (const [index, document] of p.documents.entries())
        await db.query(
          "INSERT INTO product_documents(product_id,media_id,label,archival,position) VALUES($1,$2,$3,$4,$5)",
          [
            productId,
            document.mediaId,
            document.label,
            document.archival,
            index,
          ],
        );
      await audit(db, actor, "product.documents_updated", productId, {
        previous: previousDocuments,
        current: p.documents,
      });
    }
    await audit(
      db,
      actor,
      id ? "product.updated" : "product.created",
      productId,
      {
        version: saved.rows[0].version,
        stockDelta,
        priceBefore: previous?.price_cents ?? null,
        priceAfter: p.priceCents,
        status: p.status,
      },
    );
    return saved.rows[0] as { id: string; version: number };
  });
}
export async function adminProduct(id: string) {
  uuid.parse(id);
  const {
    rows: [product],
  } = await query<{
    id: string;
    version: number;
    stock: number;
    description_html: string;
    status: string;
    [key: string]: unknown;
  }>("SELECT * FROM products WHERE id=$1", [id]);
  if (!product) return null;
  const [{ rows: categories }, { rows: media }, { rows: documents }] =
    await Promise.all([
      query("SELECT category_id FROM product_categories WHERE product_id=$1", [
        id,
      ]),
      query(
        "SELECT id,path,alt,mime_type FROM media WHERE product_id=$1 AND mime_type LIKE 'image/%' ORDER BY position,id",
        [id],
      ),
      query(
        'SELECT d.media_id AS "mediaId",d.label,d.archival,m.path FROM product_documents d JOIN media m ON m.id=d.media_id WHERE d.product_id=$1 ORDER BY d.position,d.media_id',
        [id],
      ),
    ]);
  return {
    ...product,
    categoryIds: categories.map((c) => c.category_id),
    media,
    documents,
  };
}
export const categoryInput = z
  .object({
    version: version.optional(),
    name,
    slug,
    parentId: uuid.nullable(),
    descriptionHtml: z.string().max(30000),
    visible: z.boolean(),
    position: z.number().int().min(0).max(10000),
  })
  .strict();
export async function saveCategory(raw: unknown, actor: string, id?: string) {
  if (id) uuid.parse(id);
  const p = categoryInput.parse(raw);
  return transaction(async (db) => {
    // Serializes topology changes so concurrent parent edits cannot form a cycle.
    await db.query("SELECT pg_advisory_xact_lock(47108216)");
    let previousSlug: string | undefined;
    if (id) {
      const {
        rows: [old],
      } = await db.query(
        "SELECT version,slug FROM categories WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!old)
        throw new StoreError("NOT_FOUND", "Nie znaleziono kategorii.", 404);
      if (old.version !== p.version) throw conflict();
      previousSlug = old.slug;
    }
    if (p.parentId) {
      const { rows } = await db.query(
        "WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM categories WHERE id=$1 UNION SELECT c.id,c.parent_id FROM categories c JOIN ancestors a ON c.id=a.parent_id) SELECT id FROM ancestors",
        [p.parentId],
      );
      if (!rows.length || rows.some((r) => r.id === id))
        throw new StoreError(
          "CATEGORY_CYCLE",
          "Nieprawidłowa kategoria nadrzędna.",
        );
    }
    const values = [
      p.name,
      p.slug,
      p.parentId,
      cleanHtml(p.descriptionHtml),
      p.visible,
      p.position,
    ];
    const {
      rows: [saved],
    } = id
      ? await db.query(
          "UPDATE categories SET name=$1,slug=$2,parent_id=$3,description_html=$4,visible=$5,position=$6,version=version+1 WHERE id=$7 RETURNING id,version",
          [...values, id],
        )
      : await db.query(
          "INSERT INTO categories(name,slug,parent_id,description_html,visible,position) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version",
          values,
        );
    await db.query("UPDATE redirects SET active=false WHERE source_path=$1", [
      `/kategoria/${p.slug}`,
    ]);
    if (previousSlug && previousSlug !== p.slug)
      await db.query(
        "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,301) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=301,active=true",
        [`/kategoria/${previousSlug}`, `/kategoria/${p.slug}`],
      );
    await audit(
      db,
      actor,
      id ? "category.updated" : "category.created",
      saved.id,
    );
    return saved;
  });
}
export const pageInput = z
  .object({
    version: version.optional(),
    slug,
    title: name,
    bodyHtml: z.string().max(200000),
    metaDescription: z.string().max(320),
    published: z.boolean(),
  })
  .strict();
export async function savePage(raw: unknown, actor: string, id?: string) {
  if (id) uuid.parse(id);
  const p = pageInput.parse(raw);
  if (
    [
      "admin",
      "api",
      "konto",
      "katalog",
      "kontakt",
      "przemysl",
      "dystrybutorzy",
      "produkt",
      "kategoria",
      "zamowienie",
      "odstapienie",
      "media",
      "baza-wiedzy",
      "teksas",
    ].includes(p.slug)
  )
    throw new StoreError(
      "RESERVED_SLUG",
      "Ten adres obsługuje inna część sklepu. Wybierz inny adres strony.",
      409,
    );
  return transaction(async (db) => {
    // Lock order matches settings approval and checkout; a concurrent edit cannot escape invalidation.
    await db.query("SELECT key FROM settings WHERE key='store' FOR UPDATE");
    let previousSlug: string | undefined;
    if (id) {
      const {
        rows: [old],
      } = await db.query(
        "SELECT version,slug FROM pages WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!old)
        throw new StoreError("NOT_FOUND", "Nie znaleziono strony.", 404);
      if (old.version !== p.version) throw conflict();
      previousSlug = old.slug;
    }
    if (
      previousSlug &&
      legalSlugs.includes(previousSlug) &&
      previousSlug !== p.slug
    )
      throw new StoreError(
        "LEGAL_SLUG_FIXED",
        "Adres dokumentu sprzedaży pozostaje stały. Możesz zmienić jego tytuł i treść.",
        409,
      );
    const values = [
      p.slug,
      p.title,
      cleanHtml(p.bodyHtml),
      p.metaDescription,
      p.published,
    ];
    const {
      rows: [saved],
    } = id
      ? await db.query(
          "UPDATE pages SET slug=$1,title=$2,body_html=$3,meta_description=$4,published=$5,version=version+1,updated_at=now() WHERE id=$6 RETURNING id,version",
          [...values, id],
        )
      : await db.query(
          "INSERT INTO pages(slug,title,body_html,meta_description,published) VALUES($1,$2,$3,$4,$5) RETURNING id,version",
          values,
        );
    await db.query("UPDATE redirects SET active=false WHERE source_path=$1", [
      `/${p.slug}`,
    ]);
    if (previousSlug && previousSlug !== p.slug)
      await db.query(
        "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,301) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=301,active=true",
        [`/${previousSlug}`, `/${p.slug}`],
      );
    await audit(db, actor, id ? "page.updated" : "page.created", saved.id, {
      published: p.published,
    });
    if (
      legalSlugs.includes(p.slug) ||
      (previousSlug && legalSlugs.includes(previousSlug))
    )
      await db.query(
        "UPDATE settings SET value=value || '{\"legalApproved\":false,\"checkoutEnabled\":false}'::jsonb,version=version+1,updated_at=now() WHERE key='store'",
      );
    return saved;
  });
}
export async function saveInquiry(raw: unknown, actor: string, id: string) {
  uuid.parse(id);
  const p = z
    .object({
      version,
      status: z.enum(["new", "in_progress", "closed"]),
      internalNote: z.string().max(10000),
    })
    .strict()
    .parse(raw);
  return transaction(async (db) => {
    const {
      rows: [saved],
    } = await db.query(
      "UPDATE inquiries SET status=$1,internal_note=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING id,version",
      [p.status, p.internalNote, id, p.version],
    );
    if (!saved) throw conflict();
    await audit(db, actor, "inquiry.updated", id, { status: p.status });
    return saved;
  });
}
export async function saveSettings(raw: unknown, actor: string) {
  const p = z
    .object({ version, value: settingsSchema.strict() })
    .strict()
    .parse(raw);
  if (
    new Set(p.value.shippingMethods.map((s) => s.id)).size !==
    p.value.shippingMethods.length
  )
    throw new StoreError(
      "SHIPPING_DUPLICATE",
      "Identyfikatory dostaw muszą być unikalne.",
    );
  return transaction(async (db) => {
    const {
      rows: [current],
    } = await db.query(
      "SELECT version FROM settings WHERE key='store' FOR UPDATE",
    );
    if (current?.version !== p.version) throw conflict();
    if (p.value.legalApproved) await approveLegalVersion(db, p.value, actor);
    const {
      rows: [saved],
    } = await db.query(
      "UPDATE settings SET value=$1,version=version+1,updated_at=now() WHERE key='store' AND version=$2 RETURNING version",
      [JSON.stringify(p.value), p.version],
    );
    if (!saved) throw conflict();
    await audit(db, actor, "settings.updated", "store", {
      version: saved.version,
      checkoutEnabled: p.value.checkoutEnabled,
    });
    return saved;
  });
}
