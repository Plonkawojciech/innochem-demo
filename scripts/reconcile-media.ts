import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { database, transaction } from "../lib/server/db";
type Row = Record<string, string>;
type Media = {
  source_path: string;
  path: string;
  size_bytes: number;
  sha256: string;
};
function encodedNames(value: string) {
  return [
    value.replace(/[łżó]/g, "+-").replace(/\u00a0/g, "T-"),
    value.replace(/ł/g, "ъ").replace(/ż/g, "е").replace(/ó/g, "є"),
  ];
}
function dimension(meta: string, name: string) {
  const match = meta.match(
    new RegExp(`s:${name.length}:"${name}";(?:s:\\d+:"(\\d+)"|i:(\\d+));`),
  );
  return match ? Number(match[1] || match[2]) : 0;
}
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: tsx scripts/reconcile-media.ts /private/legacy-data.json [--apply]",
    );
  const root = path.dirname(source);
  const { tables: t } = JSON.parse(await readFile(source, "utf8")) as {
    tables: Record<string, Row[]>;
  };
  const media = JSON.parse(
    await readFile(path.join(root, "media-inventory.json"), "utf8"),
  ) as Media[];
  const byPath = new Map(media.map((m) => [m.source_path, m]));
  const aliases = new Map<string, string>();
  const results: Record<string, unknown>[] = [];
  for (const item of t.wp_postmeta.filter(
    (m) => m.meta_key === "_wp_attached_file",
  )) {
    const from = `wp-content/uploads/${item.meta_value}`;
    const meta =
      t.wp_postmeta.find(
        (m) =>
          m.post_id === item.post_id &&
          m.meta_key === "_wp_attachment_metadata",
      )?.meta_value || "";
    const original = byPath.get(from);
    let target = original,
      status = original
        ? "exact"
        : /\.(?:html?|doc|odt)$/i.test(from)
          ? "non-media-preserved-in-encrypted-website-backup"
          : "missing-original";
    const candidates = encodedNames(from).filter(
      (p) => p !== from && byPath.has(p),
    );
    if (!target && new Set(candidates).size === 1) {
      target = byPath.get(candidates[0]);
      status = "filename-encoding-reconciled";
    }
    const width = dimension(meta, "width"),
      height = dimension(meta, "height");
    if (target && width && height) {
      const actual = await sharp(
        path.join(root, "media", target.source_path),
      ).metadata();
      if (actual.width !== width || actual.height !== height)
        throw new Error(
          `Original dimensions mismatch for attachment ${item.post_id}`,
        );
    }
    const files = [...meta.matchAll(/s:4:"file";s:\d+:"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((n) => !n.includes("/"));
    const variants = files.map((file) => `${path.posix.dirname(from)}/${file}`);
    for (const variant of variants) {
      const found = byPath.has(variant)
        ? variant
        : encodedNames(variant).find((p) => byPath.has(p));
      if (found && found !== variant) aliases.set(variant, found);
    }
    if (!target && item.post_id === "287") {
      // Three surviving derivative files are byte-identical to attachment 282; no claim that the lost original survived.
      const pairs = variants
        .map((v) => encodedNames(v)[0])
        .map((v) => [
          byPath.get(v),
          byPath.get(v.replace(/1(-\d+x\d+\.)/, "$1")),
        ]);
      const equivalent = byPath.get(encodedNames(from)[0].replace(/1\./, "."));
      if (
        equivalent &&
        pairs.length === 3 &&
        pairs.every(([a, b]) => a && b && a.sha256 === b.sha256)
      ) {
        target = equivalent;
        status = "equivalent-image-verified-by-three-identical-derivatives";
      }
    }
    if (!target && item.post_id === "694") {
      const choices = [];
      for (const variant of variants) {
        const m = byPath.get(variant);
        if (m) {
          const size = await sharp(
            path.join(root, "media", variant),
          ).metadata();
          choices.push({ m, area: (size.width || 0) * (size.height || 0) });
        }
      }
      choices.sort((a, b) => b.area - a.area);
      target = choices[0]?.m;
      if (target) status = "surviving-largest-derivative-original-missing";
    }
    if (target && target.source_path !== from)
      aliases.set(from, target.source_path);
    results.push({
      attachmentId: item.post_id,
      source: from,
      status,
      target: target?.source_path ?? null,
      sha256: target?.sha256 ?? null,
      sourceWidth: width,
      sourceHeight: height,
    });
  }
  const report = {
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    counts: Object.fromEntries(
      [...new Set(results.map((r) => String(r.status)))].map((s) => [
        s,
        results.filter((r) => r.status === s).length,
      ]),
    ),
    aliases: aliases.size,
    results,
  };
  if (report.mode === "apply")
    await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(842615913)");
      for (const [from, to] of aliases) {
        const destination =
          "/media/" + to.split("/").map(encodeURIComponent).join("/");
        for (const sourcePath of [`/${from}`, `/media/${from}`])
          await db.query(
            "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,301) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=301",
            [sourcePath, destination],
          );
      }
    });
  await writeFile(
    path.join(root, "media-reconciliation-final.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      mode: report.mode,
      counts: report.counts,
      aliases: report.aliases,
      missing: results
        .filter((r) => r.status === "missing-original")
        .map((r) => ({ id: r.attachmentId, path: r.source })),
    }),
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Media reconciliation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
