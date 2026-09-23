import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backup, restore } from "../scripts/backup.mjs";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
test("encrypted backup authenticates contents before restoring and reproduces database plus original filenames", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "innochem-backup-test-"),
  );
  const before = { ...process.env };
  try {
    const media = path.join(directory, "source");
    await mkdir(media);
    await mkdir(path.join(media, "nested"));
    const bytes = randomBytes(128000);
    await writeFile(path.join(media, "nested", "zdjęcie test.webp"), bytes);
    process.env.MEDIA_ROOT = media;
    process.env.BACKUP_QUIESCED = "true";
    process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const target = path.join(directory, "backup");
    const result = await backup(target);
    assert.equal(result.mediaFiles, 1);
    const original = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await assert.rejects(
      restore(
        target,
        path.join(directory, "wrong-key"),
        `innochem_restore_wrong_${Date.now()}`,
      ),
    );
    process.env.BACKUP_ENCRYPTION_KEY = original;
    const bad = path.join(directory, "corrupt");
    await mkdir(bad);
    for (const filename of await readdir(target))
      await copyFile(path.join(target, filename), path.join(bad, filename));
    const corrupt = await readFile(path.join(bad, "database.enc"));
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(path.join(bad, "database.enc"), corrupt);
    await assert.rejects(
      restore(
        bad,
        path.join(directory, "corrupt-restore"),
        `innochem_restore_corrupt_${Date.now()}`,
      ),
      /checksum mismatch/,
    );
    const restored = await restore(
      target,
      path.join(directory, "restored"),
      `innochem_restore_test_${Date.now()}`,
    );
    assert.equal(restored.verified, true);
    assert.deepEqual(
      await readFile(
        path.join(restored.mediaRoot, "nested", "zdjęcie test.webp"),
      ),
      bytes,
    );
    await assert.rejects(
      restore(target, path.join(directory, "restored"), "innochem"),
      /new innochem_restore/,
    );
    await assert.rejects(backup(target), /EEXIST/);
  } finally {
    for (const k of ["MEDIA_ROOT", "BACKUP_QUIESCED", "BACKUP_ENCRYPTION_KEY"])
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
  }
});
