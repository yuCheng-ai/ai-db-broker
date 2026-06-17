import fs from "node:fs";
import path from "node:path";
import { aiDbPath, ensureDir, sanitizeFilePart, timestampForFile } from "./paths";
import { createAdapter } from "./db";
import { logOperation } from "./logger";
import { assertSafeSql } from "./security";
import { getTemplate } from "./templates";
import type { DbConnection, PlanFile } from "./types";

export async function createPlan(connectionName: string, connection: DbConnection, templateName: string): Promise<{
  plan: PlanFile;
  filePath: string;
}> {
  const template = getTemplate(templateName);
  const adapter = createAdapter(connection, "read");
  try {
    await adapter.connect();
    const existingTables = new Set((await adapter.listTables()).map((table) => table.toLowerCase()));
    const statements = [];
    const skippedTables = [];

    for (const table of template.tables) {
      if (existingTables.has(table.toLowerCase())) {
        skippedTables.push(table);
        continue;
      }
      statements.push({
        table,
        sql: template.sql[connection.type][table],
      });
    }

    const createdAt = new Date().toISOString();
    const id = `${timestampForFile(new Date(createdAt))}-${sanitizeFilePart(connectionName)}-${template.name}`;
    const plan: PlanFile = {
      version: 1,
      id,
      connection: connectionName,
      template: template.name,
      dialect: connection.type,
      createdAt,
      statements,
      skippedTables,
    };

    ensureDir(aiDbPath("plans"));
    const filePath = aiDbPath("plans", `${id}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    logOperation({
      operation: "plan",
      connection: connectionName,
      mode: connection.mode,
      details: {
        template: template.name,
        plan: path.basename(filePath),
        creates: statements.map((statement) => statement.table),
        skippedTables,
      },
    });
    return { plan, filePath };
  } finally {
    await adapter.disconnect();
  }
}

export function readPlan(connectionName: string, planArg: string): { plan: PlanFile; filePath: string } {
  if (planArg === "latest") {
    return readLatestPlan(connectionName);
  }

  const candidates = [
    path.isAbsolute(planArg) ? planArg : aiDbPath("plans", planArg),
    path.isAbsolute(planArg) ? planArg : aiDbPath("plans", `${planArg}.json`),
  ];

  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new Error(`Plan "${planArg}" was not found in .ai-db/plans`);
  }

  return { plan: validatePlan(readJson(filePath), filePath, connectionName), filePath };
}

export interface PlanSummary {
  id: string;
  connection: string;
  template: string;
  dialect: string;
  createdAt: string;
  fileName: string;
  statements: number;
  skippedTables: number;
}

export function listPlans(connectionName?: string): PlanSummary[] {
  const plansDir = aiDbPath("plans");
  if (!fs.existsSync(plansDir)) {
    return [];
  }

  const plans: PlanSummary[] = [];
  for (const entry of fs.readdirSync(plansDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(plansDir, entry);
    try {
      const plan = validatePlan(readJson(filePath), filePath, connectionName);
      plans.push({
        id: plan.id,
        connection: plan.connection,
        template: plan.template,
        dialect: plan.dialect,
        createdAt: plan.createdAt,
        fileName: entry,
        statements: plan.statements.length,
        skippedTables: plan.skippedTables.length,
      });
    } catch {
      continue;
    }
  }

  return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function applyPlan(connectionName: string, connection: DbConnection, planArg: string, options: {
  allowProd: boolean;
  dryRun: boolean;
}): Promise<{
  plan: PlanFile;
  filePath: string;
  appliedCount: number;
  dryRun: boolean;
}> {
  if (connection.mode === "prod" && !options.allowProd) {
    throw new Error("Refusing to apply to prod connection without --allow-prod");
  }

  const { plan, filePath } = readPlan(connectionName, planArg);
  if (plan.dialect !== connection.type) {
    throw new Error(`Plan dialect ${plan.dialect} does not match connection type ${connection.type}`);
  }

  for (const statement of plan.statements) {
    assertSafeSql(statement.sql);
  }

  if (options.dryRun) {
    logOperation({
      operation: "apply:dry-run",
      connection: connectionName,
      mode: connection.mode,
      details: {
        plan: path.basename(filePath),
        plannedTables: plan.statements.map((statement) => statement.table),
      },
    });
    return { plan, filePath, appliedCount: 0, dryRun: true };
  }

  const adapter = createAdapter(connection, "write");
  try {
    await adapter.connect();
    await adapter.executeStatements(plan.statements.map((statement) => statement.sql));
    logOperation({
      operation: "apply",
      connection: connectionName,
      mode: connection.mode,
      details: {
        plan: path.basename(filePath),
        appliedTables: plan.statements.map((statement) => statement.table),
      },
    });
    return { plan, filePath, appliedCount: plan.statements.length, dryRun: false };
  } finally {
    await adapter.disconnect();
  }
}

function readLatestPlan(connectionName: string): { plan: PlanFile; filePath: string } {
  const plansDir = aiDbPath("plans");
  if (!fs.existsSync(plansDir)) {
    throw new Error("No .ai-db/plans directory found. Run `ai-db plan` first.");
  }

  const matches: Array<{ plan: PlanFile; filePath: string }> = [];
  for (const entry of fs.readdirSync(plansDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(plansDir, entry);
    try {
      const plan = validatePlan(readJson(filePath), filePath, connectionName);
      matches.push({ plan, filePath });
    } catch {
      continue;
    }
  }

  matches.sort((a, b) => b.plan.createdAt.localeCompare(a.plan.createdAt));
  const latest = matches[0];
  if (!latest) {
    throw new Error(`No plan found for connection "${connectionName}"`);
  }
  return latest;
}

function validatePlan(value: unknown, filePath: string, connectionName?: string): PlanFile {
  if (!isRecord(value)) {
    throw new Error(`Plan ${filePath} must be a JSON object`);
  }
  if (value.version !== 1) {
    throw new Error(`Plan ${filePath} version must be 1`);
  }
  if (connectionName !== undefined && value.connection !== connectionName) {
    throw new Error(`Plan ${filePath} is for connection "${String(value.connection)}", not "${connectionName}"`);
  }
  if (value.dialect !== "sqlite" && value.dialect !== "postgres") {
    throw new Error(`Plan ${filePath} has invalid dialect`);
  }
  if (!Array.isArray(value.statements)) {
    throw new Error(`Plan ${filePath} statements must be an array`);
  }
  if (!Array.isArray(value.skippedTables)) {
    throw new Error(`Plan ${filePath} skippedTables must be an array`);
  }

  return {
    version: 1,
    id: requireString(value.id, "plan id"),
    connection: requireString(value.connection, "plan connection"),
    template: requireString(value.template, "plan template"),
    dialect: value.dialect,
    createdAt: requireString(value.createdAt, "plan createdAt"),
    statements: value.statements.map((statement, index) => validateStatement(statement, index)),
    skippedTables: value.skippedTables.map((table, index) => requireString(table, `skippedTables[${index}]`)),
  };
}

function validateStatement(value: unknown, index: number): { table: string; sql: string } {
  if (!isRecord(value)) {
    throw new Error(`Plan statement ${index} must be an object`);
  }
  return {
    table: requireString(value.table, `statements[${index}].table`),
    sql: requireString(value.sql, `statements[${index}].sql`),
  };
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
