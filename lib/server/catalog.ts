import { z } from "zod";
import { query } from "./db";
import type { StoreCategory, StoreProduct } from "../store-types";
import { productFacts } from "../product-facts";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  sku: string;
  summary: string;
  description_html: string;
  price_cents: number;
  tax_rate: string;
  stock: number;
  reserved: number;
  image_path: string | null;
  image_alt: string;
  sale_mode: "retail" | "inquiry";
  category_slugs: string[];
  meta_title: string;
  meta_description: string;
};
function mapProduct(row: ProductRow): StoreProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    summary: row.summary,
    descriptionHtml: row.description_html,
    priceCents: row.price_cents,
    taxRate: Number(row.tax_rate),
    available: Math.max(0, row.stock - row.reserved),
    imagePath: row.image_path,
    imageAlt: row.image_alt,
    saleMode: row.sale_mode,
    categorySlugs: row.category_slugs,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
  };
}
const select = `SELECT p.*, COALESCE((SELECT array_agg(c.slug ORDER BY c.position) FROM product_categories pc JOIN categories c ON c.id=pc.category_id WHERE pc.product_id=p.id AND c.visible), ARRAY[]::text[]) AS category_slugs FROM products p`;
export const catalogPageSize = 24;
export function catalogPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value)
    ? Number(value)
    : 1;
}
export async function products(
  options: {
    category?: string;
    search?: string;
    grade?: string;
    page?: number;
  } = {},
) {
  const values: unknown[] = [];
  const where = ["p.status='active'"];
  if (options.grade && /^\d{1,2}W-\d{2,3}$/.test(options.grade)) {
    values.push(`%${options.grade}%`, `%${options.grade.replace("-", "")}%`);
    where.push(
      `(p.name ILIKE $${values.length - 1} OR p.name ILIKE $${values.length})`,
    );
  }
  if (options.category) {
    values.push(options.category);
    where.push(
      `p.id IN (WITH RECURSIVE tree AS (SELECT id FROM categories WHERE slug=$${values.length} AND visible UNION SELECT c.id FROM categories c JOIN tree t ON c.parent_id=t.id WHERE c.visible) SELECT pc.product_id FROM product_categories pc JOIN tree t ON t.id=pc.category_id)`,
    );
  }
  if (options.search?.trim()) {
    values.push(
      `%${options.search
        .trim()
        .slice(0, 120)
        .replace(/[\\%_]/g, "\\$&")}%`,
    );
    where.push(
      `(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length})`,
    );
  }
  const page =
    Number.isSafeInteger(options.page) && options.page! > 0 ? options.page! : 1;
  const total = (
    await query(
      `SELECT count(*)::int AS total FROM products p WHERE ${where.join(" AND ")}`,
      values,
    )
  ).rows[0].total as number;
  const pages = Math.max(1, Math.ceil(total / catalogPageSize));
  if (page > pages) return { items: [], total, page, pages };
  const result = await query<ProductRow>(
    `${select} WHERE ${where.join(" AND ")} ORDER BY p.name,p.id LIMIT ${catalogPageSize} OFFSET $${values.length + 1}`,
    [...values, (page - 1) * catalogPageSize],
  );
  return { items: result.rows.map(mapProduct), total, page, pages };
}
/** Viscosity grades present among active retail products, for catalog filters. */
export async function catalogGrades(category?: string) {
  const values: unknown[] = [];
  let where = "status='active' AND sale_mode='retail'";
  if (category) {
    values.push(category);
    where +=
      " AND id IN (WITH RECURSIVE tree AS (SELECT id FROM categories WHERE slug=$1 AND visible UNION SELECT c.id FROM categories c JOIN tree t ON c.parent_id=t.id WHERE c.visible) SELECT pc.product_id FROM product_categories pc JOIN tree t ON t.id=pc.category_id)";
  }
  const { rows } = await query<{ name: string }>(
    `SELECT name FROM products WHERE ${where}`,
    values,
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const grade = productFacts(row.name).grade;
    if (grade) counts.set(grade, (counts.get(grade) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => gradeOrder(a[0]) - gradeOrder(b[0]))
    .map(([grade, count]) => ({ grade, count }));
}
function gradeOrder(grade: string) {
  const m = grade.match(/^(\d+)W-(\d+)$/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 99999;
}
export async function cartProducts(rawIds: unknown) {
  const ids = z.array(z.uuid()).max(50).parse(rawIds);
  if (!ids.length) return [];
  const result = await query<ProductRow>(
    `${select} WHERE p.id=ANY($1::uuid[]) AND p.status='active' ORDER BY p.id`,
    [ids],
  );
  return result.rows.map((row) => ({
    ...mapProduct(row),
    descriptionHtml: "",
    summary: "",
    metaTitle: "",
    metaDescription: "",
  }));
}
export async function product(slug: string) {
  const result = await query<ProductRow>(
    `${select} WHERE p.slug=$1 AND p.status='active'`,
    [slug],
  );
  return result.rows[0] ? mapProduct(result.rows[0]) : null;
}
export async function productMedia(id: string) {
  const { rows } = await query<{ path: string; alt: string }>(
    "SELECT path,alt FROM media WHERE product_id=$1 AND mime_type LIKE 'image/%' ORDER BY position,id",
    [id],
  );
  return rows;
}
export async function categories(): Promise<StoreCategory[]> {
  const { rows } = await query(
    "SELECT id,slug,name,description_html,parent_id FROM categories WHERE visible AND legacy_id IS DISTINCT FROM 1 ORDER BY position,name",
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    descriptionHtml: r.description_html,
    parentId: r.parent_id,
  }));
}

export async function productDocuments(id: string) {
  return (
    await query<{ path: string; label: string; archival: boolean }>(
      "SELECT m.path,d.label,d.archival FROM product_documents d JOIN media m ON m.id=d.media_id WHERE d.product_id=$1 ORDER BY d.position,d.media_id",
      [id],
    )
  ).rows;
}
