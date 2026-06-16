import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { aiDbPath, ensureDir, sanitizeFilePart, timestampForFile } from "./paths";
import { logOperation } from "./logger";
import { sanitizeMessage } from "./security";
import { sqliteDatabasePath } from "./db";
import type { DbConnection } from "./types";

export function backupConnection(connectionName: string, connection: DbConnection): string {
  if (connection.type === "sqlite") {
    return backupSqlite(connectionName, connection.database, connection.mode);
  }
  return backupPostgres(connectionName, connection);
}

function backupSqlite(connectionName: string, database: string, mode: string): string {
  const source = sqliteDatabasePath(database);
  if (!fs.existsSync(source)) {
    throw new Error(`SQLite database file does not exist: ${database}`);
  }

  const backupDir = aiDbPath("backups", sanitizeFilePart(connectionName));
  ensureDir(backupDir);
  const target = path.join(backupDir, `${timestampForFile()}.db`);
  fs.copyFileSync(source, target);
  logOperation({
    operation: "backup",
    connection: connectionName,
    mode,
    details: { target: path.relative(process.cwd(), target) },
  });
  return target;
}

function backupPostgres(connectionName: string, connection: Extract<DbConnection, { type: "postgres" }>): string {
  const versionCheck = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (versionCheck.error) {
    throw new Error("pg_dump was not found. Install PostgreSQL client tools and ensure pg_dump is on PATH.");
  }

  const backupDir = aiDbPath("backups", sanitizeFilePart(connectionName));
  ensureDir(backupDir);
  const target = path.join(backupDir, `${timestampForFile()}.sql`);
  const args: string[] = [];
  if (connection.host) {
    args.push("-h", connection.host);
  }
  if (connection.port) {
    args.push("-p", String(connection.port));
  }
  if (connection.user) {
    args.push("-U", connection.user);
  }
  args.push("-d", connection.database, "-F", "p", "-f", target);

  const env = { ...process.env };
  const secrets: string[] = [];
  if (connection.passwordEnv) {
    const password = process.env[connection.passwordEnv];
    if (!password) {
      throw new Error(`Environment variable ${connection.passwordEnv} is required for PostgreSQL password`);
    }
    env.PGPASSWORD = password;
    secrets.push(password);
  }

  const result = spawnSync("pg_dump", args, { encoding: "utf8", env });
  if (result.status !== 0) {
    const stderr = sanitizeMessage(result.stderr || "pg_dump failed", secrets);
    throw new Error(stderr.trim());
  }

  logOperation({
    operation: "backup",
    connection: connectionName,
    mode: connection.mode,
    details: { target: path.relative(process.cwd(), target) },
  });
  return target;
}
