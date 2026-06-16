import fs from "node:fs";
import { configPath, aiDbPath, ensureDir } from "./paths";
import { logOperation } from "./logger";
import { assertNoPlaintextPassword } from "./security";
import type { AiDbConfig, ConnectionMode, DbConnection } from "./types";

const REQUIRED_DIRS = ["plans", "backups", "logs", "migrations"];

const EMPTY_CONFIG: AiDbConfig = {
  version: 1,
  connections: {},
};

export function initAiDb(): { createdConfig: boolean } {
  ensureDir(aiDbPath());
  for (const dir of REQUIRED_DIRS) {
    ensureDir(aiDbPath(dir));
  }

  const path = configPath();
  const createdConfig = !fs.existsSync(path);
  if (createdConfig) {
    fs.writeFileSync(path, `${JSON.stringify(EMPTY_CONFIG, null, 2)}\n`, "utf8");
  }

  logOperation({ operation: "init", details: { createdConfig } });
  return { createdConfig };
}

export function ensureInitialized(): void {
  if (!fs.existsSync(configPath())) {
    throw new Error("Missing .ai-db/config.json. Run `ai-db init` first.");
  }
}

export function loadConfig(): AiDbConfig {
  ensureInitialized();
  const rawText = fs.readFileSync(configPath(), "utf8");
  const parsed = JSON.parse(rawText) as unknown;
  assertNoPlaintextPassword(parsed, ".ai-db/config.json");
  return validateConfig(parsed);
}

export function saveConfig(config: AiDbConfig): void {
  assertNoPlaintextPassword(config, ".ai-db/config.json");
  ensureDir(aiDbPath());
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getConnection(name: string): DbConnection {
  const config = loadConfig();
  const connection = config.connections[name];
  if (!connection) {
    throw new Error(`Unknown connection "${name}"`);
  }
  return connection;
}

export function upsertConnection(name: string, connection: DbConnection): void {
  const config = loadConfig();
  config.connections[name] = connection;
  saveConfig(config);
  logOperation({
    operation: "connect",
    connection: name,
    mode: connection.mode,
    details: { type: connection.type },
  });
}

function validateConfig(value: unknown): AiDbConfig {
  if (!isRecord(value)) {
    throw new Error(".ai-db/config.json must be a JSON object");
  }

  if (value.version !== 1) {
    throw new Error(".ai-db/config.json version must be 1");
  }

  if (!isRecord(value.connections)) {
    throw new Error(".ai-db/config.json connections must be an object");
  }

  const connections: Record<string, DbConnection> = {};
  for (const [name, connection] of Object.entries(value.connections)) {
    connections[name] = validateConnection(name, connection);
  }

  return {
    version: 1,
    connections,
  };
}

function validateConnection(name: string, value: unknown): DbConnection {
  if (!isRecord(value)) {
    throw new Error(`Connection "${name}" must be an object`);
  }

  const mode = validateMode(value.mode, name);

  if (value.type === "sqlite") {
    if (typeof value.database !== "string" || value.database.trim() === "") {
      throw new Error(`SQLite connection "${name}" requires database`);
    }
    return {
      type: "sqlite",
      database: value.database,
      mode,
    };
  }

  if (value.type === "postgres") {
    if (typeof value.database !== "string" || value.database.trim() === "") {
      throw new Error(`PostgreSQL connection "${name}" requires database`);
    }
    if (value.port !== undefined && typeof value.port !== "number") {
      throw new Error(`PostgreSQL connection "${name}" port must be a number`);
    }
    return {
      type: "postgres",
      host: optionalString(value.host, `PostgreSQL connection "${name}" host`),
      port: value.port,
      database: value.database,
      user: optionalString(value.user, `PostgreSQL connection "${name}" user`),
      passwordEnv: optionalString(value.passwordEnv, `PostgreSQL connection "${name}" passwordEnv`),
      mode,
    };
  }

  throw new Error(`Connection "${name}" type must be sqlite or postgres`);
}

function validateMode(value: unknown, name: string): ConnectionMode {
  if (value === undefined) {
    return "dev";
  }
  if (value === "dev" || value === "test" || value === "prod") {
    return value;
  }
  throw new Error(`Connection "${name}" mode must be dev, test, or prod`);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
