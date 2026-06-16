export type Dialect = "sqlite" | "postgres";
export type ConnectionMode = "dev" | "test" | "prod";

export interface SQLiteConnection {
  type: "sqlite";
  database: string;
  mode: ConnectionMode;
}

export interface PostgresConnection {
  type: "postgres";
  host?: string;
  port?: number;
  database: string;
  user?: string;
  passwordEnv?: string;
  mode: ConnectionMode;
}

export type DbConnection = SQLiteConnection | PostgresConnection;

export interface AiDbConfig {
  version: 1;
  connections: Record<string, DbConnection>;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string | null;
  primaryKey?: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface InspectResult {
  connection: string;
  dialect: Dialect;
  mode: ConnectionMode;
  tables: TableInfo[];
}

export interface PlanStatement {
  table: string;
  sql: string;
}

export interface PlanFile {
  version: 1;
  id: string;
  connection: string;
  template: string;
  dialect: Dialect;
  createdAt: string;
  statements: PlanStatement[];
  skippedTables: string[];
}
