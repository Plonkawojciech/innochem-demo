import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { CategoryEditor } from "../Editors";
export default async function Categories() {
  await adminPageUser();
  const { rows } = await query(
    "SELECT * FROM categories ORDER BY position,name",
  );
  const categories = rows.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <h2 className="display">Kategorie</h2>
      <details className="panel">
        <summary>Dodaj kategorię</summary>
        <CategoryEditor key={rows.length} categories={categories} />
      </details>
      {rows.map((c) => (
        <details className="panel" key={`${c.id}:${c.version}`}>
          <summary>
            {c.name}
            {!c.visible ? " — ukryta" : ""}
          </summary>
          <CategoryEditor category={c} categories={categories} />
        </details>
      ))}
    </>
  );
}
