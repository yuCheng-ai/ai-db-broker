import fs from "node:fs";
import path from "node:path";
import Database = require("better-sqlite3");
import { Client, type ClientConfig } from "pg";
import { projectRoot, resolveProjectFile } from "./paths";
import { sanitizeMessage } from "./security";
import type { ColumnInfo, DbConnection, Dialect, TableInfo } from "./types";

export type DbAccess = "read" | "write";

export interface DbAdapter {
  readonly dialect: Dialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTables(): Promise<string[]>;
  inspectTable(table: string): Promise<ColumnInfo[]>;
  executeStatements(statements: string[]): Promise<void>;
  reset(): Promise<string[]>;
}

export function createAdapter(connection: DbConnection, access: DbAccess): DbAdapter {
  if (connection.type === "sqlite") {
    return new SqliteAdapter(connection.database, access);
  }
  return new PostgresAdapter(connection, access);
}

export async function inspectConnection(connectionName: string, connection: DbConnection): Promise<{
  connection: string;
  dialect: Dialect;
  mode: string;
  tables: TableInfo[];
}> {
  const adapter = createAdapter(connection, "read");
  try {
    await adapter.connect();
    const tableNames = await adapter.listTables();
    const tables: TableInfo[] = [];
    for (const tableName of tableNames) {
      tables.push({
        name: tableName,
        columns: await adapter.inspectTable(tableName),
      });
    }
    return {
      connection: connectionName,
      dialect: adapter.dialect,
      mode: connection.mode,
      tables,
    };
  } finally {
    await adapter.disconnect();
  }
}

export function sqliteDatabasePath(database: string): string {
  return resolveProjectFile(database);
}

class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private missingReadDatabase = false;

  constructor(database: string, private readonly access: DbAccess) {
    this.dbPath = path.isAbsolute(database) ? database : path.resolve(projectRoot(), database);
  }

  async connect(): Promise<void> {
    const exists = fs.existsSync(this.dbPath);
    if (this.access === "read" && !exists) {
      this.missingReadDatabase = true;
      return;
    }

    if (this.access === "write") {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = new Database(this.dbPath, {
      readonly: this.access === "read",
      fileMustExist: this.access === "read",
    });
    this.db.pragma("foreign_keys = ON");
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async listTables(): Promise<string[]> {
    if (this.missingReadDatabase) {
      return [];
    }
    const db = this.requireDb();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  async inspectTable(table: string): Promise<ColumnInfo[]> {
    if (this.missingReadDatabase) {
      return [];
    }
    const db = this.requireDb();
    const rows = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.notnull === 0,
      defaultValue: row.dflt_value,
      primaryKey: row.pk > 0,
    }));
  }

  async executeStatements(statements: string[]): Promise<void> {
    this.assertWriteAccess();
    if (statements.length === 0) {
      return;
    }
    const db = this.requireDb();
    const execute = db.transaction((items: string[]) => {
      for (const statement of items) {
        db.exec(statement);
      }
    });
    execute(statements);
  }

  async reset(): Promise<string[]> {
    this.assertWriteAccess();
    const tables = await this.listTables();
    const db = this.requireDb();
    const execute = db.transaction((items: string[]) => {
      for (const table of items) {
        db.exec(`DROP TABLE IF EXISTS ${quoteSqliteIdentifier(table)}`);
      }
    });
    execute(tables);
    return tables;
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite database is not connected");
    }
    return this.db;
  }

  private assertWriteAccess(): void {
    if (this.access !== "write") {
      throw new Error("Internal error: write operation attempted with read-only database adapter");
    }
  }
}

class PostgresAdapter implements DbAdapter {
  readonly dialect = "postgres" as const;
  private client: Client | null = null;
  private readonly secrets: string[] = [];

  constructor(private readonly connection: Extract<DbConnection, { type: "postgres" }>, private readonly access: DbAccess) {}

  async connect(): Promise<void> {
    const config: ClientConfig = {
      host: this.connection.host,
      port: this.connection.port ?? 5432,
      database: this.connection.database,
      user: this.connection.user,
    };

    if (this.connection.passwordEnv) {
      const password = process.env[this.connection.passwordEnv];
      if (!password) {
        throw new Error(`Environment variable ${this.connection.passwordEnv} is required for PostgreSQL password`);
      }
      config.password = password;
      this.secrets.push(password);
    }

    this.client = new Client(config);
    try {
      await this.client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeMessage(`PostgreSQL connection failed: ${message}`, this.secrets));
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  async listTables(): Promise<string[]> {
    const client = this.requireClient();
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return result.rows.map((row) => row.table_name);
  }

  async inspectTable(table: string): Promise<ColumnInfo[]> {
    const client = this.requireClient();
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    return result.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default,
    }));
  }

  async executeStatements(statements: string[]): Promise<void> {
    this.assertWriteAccess();
    if (statements.length === 0) {
      return;
    }

    const client = this.requireClient();
    await client.query("BEGIN");
    try {
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  async reset(): Promise<string[]> {
    this.assertWriteAccess();
    const tables = await this.listTables();
    if (tables.length === 0) {
      return [];
    }
    const statements = tables.map((table) => `DROP TABLE IF EXISTS public.${quotePostgresIdentifier(table)} CASCADE`);
    await this.executeStatements(statements);
    return tables;
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("PostgreSQL database is not connected");
    }
    return this.client;
  }

  private assertWriteAccess(): void {
    if (this.access !== "write") {
      throw new Error("Internal error: write operation attempted with read-only database adapter");
    }
  }
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
