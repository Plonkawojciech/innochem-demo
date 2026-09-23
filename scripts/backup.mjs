/** Encrypted, append-only backups. Restore creates a new database and a new media directory. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  lstat,
  realpath,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
const MAGIC = Buffer.from("INNOCHEM-BACKUP-1\n");
const key = () => {
  const value = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw new Error("BACKUP_ENCRYPTION_KEY must contain a 32-byte base64 key");
  return value;
};
function command(binary, args) {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  // Never print pg credentials, SQL data, or provider errors.
  child.stderr.resume();
  const done = new Promise((resolve, reject) => {
    child.on("error", () => reject(new Error(`${binary} could not start`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${binary} failed`)),
    );
  });
  // An early process failure must still be observed while streaming stdout.
  done.catch(() => {});
  return { child, done };
}
async function output(binary, args) {
  const { child, done } = command(binary, args);
  let s = "";
  for await (const chunk of child.stdout) s += chunk;
  await done;
  return s.trim();
}
async function digest(stream) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}
async function encrypt(source, filename) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const target = createWriteStream(filename, { flags: "wx", mode: 0o600 });
  target.write(MAGIC);
  target.write(nonce);
  await pipeline(source, cipher, target);
  const fd = await open(filename, "a");
  try {
    await fd.write(cipher.getAuthTag());
    await fd.sync();
  } finally {
    await fd.close();
  }
  return digest(createReadStream(filename));
}
async function decrypt(filename, target) {
  const fd = await open(filename, "r");
  let size, nonce, tag;
  try {
    size = (await fd.stat()).size;
    if (size < MAGIC.length + 28) throw new Error("Truncated backup");
    const header = Buffer.alloc(MAGIC.length + 12);
    await fd.read(header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("Unsupported backup");
    nonce = header.subarray(MAGIC.length);
    tag = Buffer.alloc(16);
    await fd.read(tag, 0, 16, size - 16);
  } finally {
    await fd.close();
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), nonce);
  decipher.setAuthTag(tag);
  // The plaintext is never interpreted before the final authentication tag succeeds.
  await pipeline(
    createReadStream(filename, { start: MAGIC.length + 12, end: size - 17 }),
    decipher,
    createWriteStream(target, { flags: "wx", mode: 0o600 }),
  );
}
async function inventory(root, prefix = "") {
  const files = [];
  for (const entry of (await readdir(path.join(root, prefix))).sort()) {
    const name = prefix ? `${prefix}/${entry}` : entry;
    const stat = await lstat(path.join(root, name));
    if (stat.isSymbolicLink())
      throw new Error("Media backups do not follow symbolic links");
    if (stat.isDirectory()) files.push(...(await inventory(root, name)));
    else if (stat.isFile())
      files.push({
        name,
        ...(await digest(createReadStream(path.join(root, name)))),
      });
    else throw new Error("Unsupported media entry");
  }
  return files;
}
async function* mediaBundle(root, files) {
  for (const file of files) {
    const header = Buffer.from(JSON.stringify(file));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    yield length;
    yield header;
    const h = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path.join(root, file.name))) {
      h.update(chunk);
      size += chunk.length;
      yield chunk;
    }
    if (size !== file.bytes || h.digest("hex") !== file.sha256)
      throw new Error("Media changed during backup");
  }
}
async function databaseFingerprint() {
  const tables = JSON.parse(
    await output("psql", [
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'",
    ]),
  );
  const result = {};
  for (const table of tables) {
    const identifier = '"' + table.replaceAll('"', '""') + '"';
    const { child, done } = command("psql", [
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SET timezone='UTC'; SELECT row_to_json(t)::text FROM public.${identifier} t ORDER BY to_jsonb(t)::text`,
    ]);
    result[table] = await digest(child.stdout);
    await done;
  }
  const sequences = JSON.parse(
    await output("psql", [
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT coalesce(json_agg(json_build_object('name',sequencename,'lastValue',last_value) ORDER BY sequencename),'[]'::json) FROM pg_sequences WHERE schemaname='public'",
    ]),
  );
  return { tables: result, sequences };
}
export async function backup(destination) {
  key();
  if (process.env.BACKUP_QUIESCED !== "true")
    throw new Error("Pause application writes and set BACKUP_QUIESCED=true");
  if (!process.env.MEDIA_ROOT) throw new Error("MEDIA_ROOT is required");
  const root = await realpath(process.env.MEDIA_ROOT);
  await mkdir(destination, { mode: 0o700 });
  const before = await databaseFingerprint();
  const files = await inventory(root);
  const dump = command("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
  ]);
  const db = await encrypt(
    dump.child.stdout,
    path.join(destination, "database.enc"),
  );
  await dump.done;
  const media = await encrypt(
    Readable.from(mediaBundle(root, files)),
    path.join(destination, "media.enc"),
  );
  if (JSON.stringify(before) !== JSON.stringify(await databaseFingerprint()))
    throw new Error(
      "Database changed during backup; this bundle is incomplete",
    );
  if (JSON.stringify(files) !== JSON.stringify(await inventory(root)))
    throw new Error("Media changed during backup; this bundle is incomplete");
  await encrypt(
    Readable.from([
      Buffer.from(
        JSON.stringify(
          {
            version: 1,
            createdAt: new Date().toISOString(),
            database: before,
            files,
          },
          null,
          2,
        ),
      ),
    ]),
    path.join(destination, "contents.enc"),
  );
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        algorithm: "AES-256-GCM",
        database: db,
        media,
        contents: await digest(
          createReadStream(path.join(destination, "contents.enc")),
        ),
        mediaFiles: files.length,
        mediaBytes: files.reduce((n, f) => n + f.bytes, 0),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  return {
    directory: destination,
    mediaFiles: files.length,
    mediaBytes: files.reduce((n, f) => n + f.bytes, 0),
    tables: Object.keys(before.tables).length,
  };
}
async function extractBundle(bundle, root, files) {
  const fd = await open(bundle, "r");
  let position = 0;
  async function exact(size) {
    const b = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await fd.read(b, offset, size - offset, position);
      if (!bytesRead) throw new Error("Truncated media bundle");
      position += bytesRead;
      offset += bytesRead;
    }
    return b;
  }
  try {
    for (const expected of files) {
      const length = (await exact(4)).readUInt32BE();
      if (length > 10000) throw new Error("Invalid media header");
      const header = JSON.parse((await exact(length)).toString("utf8"));
      if (
        JSON.stringify(header) !== JSON.stringify(expected) ||
        !Number.isSafeInteger(header.bytes) ||
        header.bytes < 0 ||
        typeof header.name !== "string" ||
        header.name.includes("\\") ||
        header.name.split("/").some((p) => !p || p === "." || p === "..") ||
        /[\x00-\x1f]/.test(header.name)
      )
        throw new Error("Invalid media path or inventory");
      const target = path.join(root, header.name);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const out = await open(target, "wx", 0o600);
      const hash = createHash("sha256");
      try {
        for (let left = header.bytes; left > 0;) {
          const chunk = await exact(Math.min(left, 1024 * 1024));
          hash.update(chunk);
          let written = 0;
          while (written < chunk.length)
            written += (await out.write(chunk, written)).bytesWritten;
          left -= chunk.length;
        }
      } finally {
        await out.close();
      }
      if (hash.digest("hex") !== header.sha256)
        throw new Error("Media checksum mismatch");
    }
    if (position !== (await fd.stat()).size)
      throw new Error("Unexpected media bundle entries");
  } finally {
    await fd.close();
  }
}
export async function restore(source, destination, databaseName) {
  key();
  if (!/^innochem_restore_[a-z0-9_]+$/.test(databaseName))
    throw new Error("Restore requires a new innochem_restore_* database");
  if (!process.env.PGHOST?.startsWith("/") || process.env.DATABASE_URL)
    throw new Error(
      "Restore test requires a local Unix socket, not a remote database",
    );
  await mkdir(destination, { mode: 0o700 });
  const manifest = JSON.parse(
    await readFile(path.join(source, "manifest.json"), "utf8"),
  );
  if (manifest.version !== 1) throw new Error("Unsupported manifest");
  for (const [file, field] of [
    ["database", "database"],
    ["media", "media"],
    ["contents", "contents"],
  ]) {
    const actual = await digest(
      createReadStream(path.join(source, `${file}.enc`)),
    );
    if (JSON.stringify(actual) !== JSON.stringify(manifest[field]))
      throw new Error("Encrypted backup checksum mismatch");
    await decrypt(
      path.join(source, `${file}.enc`),
      path.join(destination, `${file}.verified`),
    );
  }
  const contents = JSON.parse(
    await readFile(path.join(destination, "contents.verified"), "utf8"),
  );
  if (contents.version !== 1 || !Array.isArray(contents.files))
    throw new Error("Invalid inventory");
  const mediaRoot = path.join(destination, "media");
  await mkdir(mediaRoot, { mode: 0o700 });
  await extractBundle(
    path.join(destination, "media.verified"),
    mediaRoot,
    contents.files,
  );
  await output("createdb", ["--template=template0", databaseName]);
  await output("pg_restore", [
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    "--dbname",
    databaseName,
    path.join(destination, "database.verified"),
  ]);
  const previous = process.env.PGDATABASE;
  process.env.PGDATABASE = databaseName;
  let actual;
  try {
    actual = await databaseFingerprint();
  } finally {
    if (previous === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = previous;
  }
  if (JSON.stringify(actual) !== JSON.stringify(contents.database))
    throw new Error("Restored database does not match the backup fingerprint");
  if (
    JSON.stringify(await inventory(mediaRoot)) !==
    JSON.stringify(contents.files)
  )
    throw new Error("Restored media inventory mismatch");
  const report = {
    verifiedAt: new Date().toISOString(),
    database: databaseName,
    mediaRoot,
    tables: Object.keys(actual.tables).length,
    mediaFiles: contents.files.length,
    mediaBytes: contents.files.reduce((n, f) => n + f.bytes, 0),
    verified: true,
  };
  await writeFile(
    path.join(destination, "verification.json"),
    JSON.stringify(report, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  return report;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [action, ...args] = process.argv.slice(2);
  try {
    const result =
      action === "backup" && args.length === 1
        ? await backup(path.resolve(args[0]))
        : action === "restore-test" && args.length === 3
          ? await restore(path.resolve(args[0]), path.resolve(args[1]), args[2])
          : null;
    if (!result)
      throw new Error(
        "Usage: node scripts/backup.mjs backup NEW_DIRECTORY | restore-test BACKUP NEW_DIRECTORY NEW_DATABASE",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Backup failed");
    process.exitCode = 1;
  }
}
