import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import Database from "better-sqlite3";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
};

const sha256 = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const assertIntegrity = (path: string): void => {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    if (result.length !== 1 || result[0]?.integrity_check !== "ok") {
      throw new Error(`SQLite 完整性检查失败：${JSON.stringify(result)}`);
    }
  } finally {
    database.close();
  }
};

const timestamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export const backupDatabase = async (
  sourcePath: string,
  backupDirectory: string,
): Promise<string> => {
  const source = resolve(sourcePath);
  const directory = resolve(backupDirectory);
  await mkdir(directory, { recursive: true });
  const destination = resolve(directory, `app-${timestamp()}.sqlite`);
  const database = new Database(source, { fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  assertIntegrity(destination);
  const digest = await sha256(destination);
  await writeFile(`${destination}.sha256`, `${digest}  ${basename(destination)}\n`, {
    mode: 0o600,
  });
  return destination;
};

export const restoreDatabase = async (
  backupPath: string,
  destinationPath: string,
): Promise<string> => {
  const backup = resolve(backupPath);
  const destination = resolve(destinationPath);
  const checksumText = await readFile(`${backup}.sha256`, "utf8");
  const expected = checksumText.trim().split(/\s+/)[0];
  if (!expected || expected !== (await sha256(backup))) {
    throw new Error("备份 SHA-256 校验失败");
  }
  assertIntegrity(backup);
  await mkdir(dirname(destination), { recursive: true });
  const staged = `${destination}.restore-${timestamp()}`;
  await copyFile(backup, staged);
  assertIntegrity(staged);
  const previous = `${destination}.before-restore-${timestamp()}`;
  try {
    await rename(destination, previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(staged, destination);
  return previous;
};

const command = process.argv[2];
if (command === "backup") {
  const created = await backupDatabase(
    required("SQLITE_PATH"),
    process.env.BACKUP_DIR ?? "./backups",
  );
  process.stdout.write(`${created}\n`);
} else if (command === "restore") {
  const confirmation = required("CONFIRM_SQLITE_RESTORE");
  if (confirmation !== "RESTORE") throw new Error("CONFIRM_SQLITE_RESTORE 必须为 RESTORE");
  const previous = await restoreDatabase(
    required("BACKUP_FILE"),
    required("SQLITE_PATH"),
  );
  process.stdout.write(`恢复完成；原数据库保留在 ${previous}\n`);
} else {
  throw new Error("用法：backup.ts backup|restore");
}
