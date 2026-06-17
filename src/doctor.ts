import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { aiDbPath, configPath, resolveProjectFile } from "./paths";
import { inspectConnection } from "./db";
import { loadConfig } from "./config";
import type { AiDbConfig, DbConnection } from "./types";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
}

export async function runDoctor(connectionName?: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(checkPath(".ai-db directory", aiDbPath(), "Run `ai-db init` first."));
  checks.push(checkPath("config file", configPath(), "Run `ai-db init` first."));
  for (const dir of ["plans", "backups", "logs", "migrations"]) {
    checks.push(checkPath(`${dir} directory`, aiDbPath(dir), `Run \`ai-db init\` to create .ai-db/${dir}.`));
  }

  let config: AiDbConfig | null = null;
  try {
    config = loadConfig();
    checks.push({ name: "config syntax", status: "ok", message: ".ai-db/config.json is valid." });
  } catch (error) {
    checks.push({
      name: "config syntax",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
    return checks;
  }

  const connectionNames = Object.keys(config.connections);
  if (connectionNames.length === 0) {
    checks.push({ name: "connections", status: "warn", message: "No connections configured yet." });
    return checks;
  }
  checks.push({ name: "connections", status: "ok", message: `${connectionNames.length} connection(s) configured.` });

  if (connectionName) {
    const connection = config.connections[connectionName];
    if (!connection) {
      checks.push({ name: "selected connection", status: "fail", message: `Unknown connection "${connectionName}".` });
      return checks;
    }
    checks.push(...(await checkConnection(connectionName, connection)));
    return checks;
  }

  for (const [name, connection] of Object.entries(config.connections)) {
    checks.push(...checkConnectionConfig(name, connection));
  }
  return checks;
}

export function hasDoctorFailures(checks: DoctorCheck[]): boolean {
  return checks.some((check) => check.status === "fail");
}

function checkPath(name: string, filePath: string, missingMessage: string): DoctorCheck {
  if (fs.existsSync(filePath)) {
    return { name, status: "ok", message: `${filePath} exists.` };
  }
  return { name, status: "fail", message: missingMessage };
}

async function checkConnection(name: string, connection: DbConnection): Promise<DoctorCheck[]> {
  const checks = checkConnectionConfig(name, connection);

  try {
    const result = await inspectConnection(name, connection);
    checks.push({
      name: `${name} connectivity`,
      status: "ok",
      message: `Schema inspection succeeded; ${result.tables.length} table(s) found.`,
    });
  } catch (error) {
    checks.push({
      name: `${name} connectivity`,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

function checkConnectionConfig(name: string, connection: DbConnection): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      name: `${name} type`,
      status: "ok",
      message: `${connection.type} connection in ${connection.mode} mode.`,
    },
  ];

  if (connection.type === "sqlite") {
    const dbPath = resolveProjectFile(connection.database);
    checks.push({
      name: `${name} sqlite file`,
      status: fs.existsSync(dbPath) ? "ok" : "warn",
      message: fs.existsSync(dbPath)
        ? `${dbPath} exists.`
        : `${dbPath} does not exist yet; write operations can create it.`,
    });
    return checks;
  }

  if (connection.passwordEnv) {
    checks.push({
      name: `${name} password env`,
      status: process.env[connection.passwordEnv] ? "ok" : "fail",
      message: process.env[connection.passwordEnv]
        ? `${connection.passwordEnv} is set.`
        : `${connection.passwordEnv} is not set in the environment.`,
    });
  } else {
    checks.push({
      name: `${name} password env`,
      status: "warn",
      message: "No passwordEnv configured; use only if PostgreSQL auth does not require a password.",
    });
  }

  const pgDump = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  checks.push({
    name: `${name} pg_dump`,
    status: pgDump.error ? "warn" : "ok",
    message: pgDump.error
      ? "pg_dump was not found; PostgreSQL backup will fail until PostgreSQL client tools are installed."
      : pgDump.stdout.trim(),
  });

  return checks;
}
