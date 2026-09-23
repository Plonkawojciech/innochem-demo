import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPageUser } from "@/lib/server/admin-page";
import { adminProduct } from "@/lib/server/admin";
import { query } from "@/lib/server/db";
import { ProductEditor } from "../../ProductEditor";
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await adminPageUser();
  const { id } = await params;
  if (id !== "nowy" && !z.uuid().safeParse(id).success) notFound();
  const product = id === "nowy" ? null : await adminProduct(id);
  if (id !== "nowy" && !product) notFound();
  const { rows: categories } = await query(
    "SELECT id,name FROM categories ORDER BY position,name",
  );
  return (
    <ProductEditor
      product={product ? JSON.parse(JSON.stringify(product)) : null}
      categories={categories as { id: string; name: string }[]}
    />
  );
}
