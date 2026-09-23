import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { PageEditor } from "../../Editors";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await adminPageUser();
  const { id } = await params;
  if (id !== "nowa" && !z.uuid().safeParse(id).success) notFound();
  const page =
    id === "nowa"
      ? null
      : (await query("SELECT * FROM pages WHERE id=$1", [id])).rows[0];
  if (id !== "nowa" && !page) notFound();
  return (
    <section className="panel">
      <h2 className="display">{page?.title || "Nowa strona"}</h2>
      <PageEditor page={page ? JSON.parse(JSON.stringify(page)) : undefined} />
    </section>
  );
}
