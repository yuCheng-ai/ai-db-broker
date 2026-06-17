#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import path from "node:path";
import { backupConnection } from "./backup";
import { getConnection, initAiDb, loadConfig, upsertConnection } from "./config";
import { inspectConnection } from "./db";
import { hasDoctorFailures, runDoctor } from "./doctor";
import { applyPlan, createPlan, listPlans, readPlan } from "./plans";
import { resetConnection } from "./reset";
import { redactSecrets } from "./security";
import { listTemplates } from "./templates";
import type { ConnectionMode, DbConnection } from "./types";

const program = new Command();

program
  .name("ai-db")
  .description("CLI-first local database broker for AI coding tools without exposing database passwords.")
  .version("0.1.0");

program
  .command("init")
  .description("Create the local .ai-db directory structure.")
  .action(run(() => {
    const result = initAiDb();
    console.log(result.createdConfig ? "Initialized .ai-db" : ".ai-db already initialized");
  }));

program
  .command("connect")
  .argument("<name>", "Connection name AI tools will use")
  .description("Create or update a named local database connection.")
  .requiredOption("--type <type>", "Connection type: sqlite or postgres", parseConnectionType)
  .option("--database <database>", "Database path for SQLite or database name for PostgreSQL")
  .option("--host <host>", "PostgreSQL host")
  .option("--port <port>", "PostgreSQL port", parsePort)
  .option("--user <user>", "PostgreSQL user")
  .option("--password-env <env>", "Environment variable name containing PostgreSQL password")
  .option("--mode <mode>", "Connection mode: dev, test, or prod", parseMode, "dev")
  .action(run((name: string, options: ConnectOptions) => {
    const connection = buildConnection(options);
    upsertConnection(name, connection);
    console.log(`Saved connection "${name}" (${connection.type}, ${connection.mode})`);
  }));

program
  .command("connections")
  .description("List configured connections without printing secrets.")
  .action(run(() => {
    const config = loadConfig();
    console.log(JSON.stringify(redactSecrets(config.connections), null, 2));
  }));

program
  .command("doctor")
  .description("Check local configuration, connection readiness, and backup prerequisites.")
  .option("--conn <name>", "Connection name to probe")
  .action(run(async (options: Partial<ConnOptions>) => {
    const checks = await runDoctor(options.conn);
    for (const check of checks) {
      console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
    }
    if (hasDoctorFailures(checks)) {
      process.exitCode = 1;
    }
  }));

program
  .command("inspect")
  .description("Inspect database schema only; never reads business data.")
  .requiredOption("--conn <name>", "Connection name")
  .action(run(async (options: ConnOptions) => {
    const connection = getConnection(options.conn);
    const result = await inspectConnection(options.conn, connection);
    console.log(JSON.stringify(result, null, 2));
  }));

program
  .command("templates")
  .description("List built-in schema templates and their tables.")
  .action(run(() => {
    for (const template of listTemplates()) {
      console.log(`${template.name}`);
      console.log(`  tables: ${template.tables.join(", ")}`);
    }
  }));

program
  .command("plan")
  .description("Create a create-missing-tables plan from a built-in template.")
  .requiredOption("--conn <name>", "Connection name")
  .requiredOption("--template <template>", "Template name")
  .action(run(async (options: PlanOptions) => {
    const connection = getConnection(options.conn);
    const result = await createPlan(options.conn, connection, options.template);
    console.log(`Created plan ${path.basename(result.filePath)}`);
    console.log(`Tables to create: ${result.plan.statements.length}`);
    console.log(`Tables skipped: ${result.plan.skippedTables.length}`);
  }));

program
  .command("plans")
  .description("List saved plans from .ai-db/plans.")
  .option("--conn <name>", "Only show plans for a connection")
  .action(run((options: Partial<ConnOptions>) => {
    const plans = listPlans(options.conn);
    if (plans.length === 0) {
      console.log(options.conn ? `No plans found for connection "${options.conn}"` : "No plans found");
      return;
    }
    for (const plan of plans) {
      console.log(`${plan.fileName}`);
      console.log(`  conn=${plan.connection} template=${plan.template} dialect=${plan.dialect}`);
      console.log(`  created=${plan.createdAt} statements=${plan.statements} skipped=${plan.skippedTables}`);
    }
  }));

program
  .command("show-plan")
  .description("Print a saved plan for human review before apply.")
  .requiredOption("--conn <name>", "Connection name")
  .requiredOption("--plan <plan>", "Plan id, file name, path, or latest")
  .option("--summary", "Only show metadata and table lists, not SQL", false)
  .action(run((options: ShowPlanOptions) => {
    const result = readPlan(options.conn, options.plan);
    const plan = result.plan;
    console.log(`Plan: ${path.basename(result.filePath)}`);
    console.log(`Connection: ${plan.connection}`);
    console.log(`Template: ${plan.template}`);
    console.log(`Dialect: ${plan.dialect}`);
    console.log(`Created: ${plan.createdAt}`);
    console.log(`Tables to create: ${plan.statements.map((statement) => statement.table).join(", ") || "(none)"}`);
    console.log(`Tables skipped: ${plan.skippedTables.join(", ") || "(none)"}`);

    if (!options.summary) {
      for (const [index, statement] of plan.statements.entries()) {
        console.log("");
        console.log(`-- ${index + 1}. ${statement.table}`);
        console.log(statement.sql);
      }
    }
  }));

program
  .command("apply")
  .description("Apply a plan from .ai-db/plans.")
  .requiredOption("--conn <name>", "Connection name")
  .requiredOption("--plan <plan>", "Plan id, file name, path, or latest")
  .option("--allow-prod", "Allow apply against a prod connection", false)
  .option("--dry-run", "Validate and preview the plan without executing SQL", false)
  .action(run(async (options: ApplyOptions) => {
    const connection = getConnection(options.conn);
    const result = await applyPlan(options.conn, connection, options.plan, {
      allowProd: options.allowProd,
      dryRun: options.dryRun,
    });
    if (result.dryRun) {
      console.log(`Dry run passed for ${path.basename(result.filePath)}`);
      console.log(`Statements planned: ${result.plan.statements.length}`);
      console.log("No SQL was executed.");
      return;
    }
    console.log(`Applied plan ${path.basename(result.filePath)}`);
    console.log(`Statements applied: ${result.appliedCount}`);
  }));

program
  .command("backup")
  .description("Backup a configured connection.")
  .requiredOption("--conn <name>", "Connection name")
  .action(run((options: ConnOptions) => {
    const connection = getConnection(options.conn);
    const backupPath = backupConnection(options.conn, connection);
    console.log(`Backup written to ${backupPath}`);
  }));

program
  .command("reset")
  .description("Drop all user tables for a dev/test connection.")
  .requiredOption("--conn <name>", "Connection name")
  .option("--dev", "Required safety flag for reset", false)
  .action(run(async (options: ResetOptions) => {
    const connection = getConnection(options.conn);
    const droppedTables = await resetConnection(options.conn, connection, options.dev);
    console.log(`Reset connection "${options.conn}"`);
    console.log(`Tables dropped: ${droppedTables.length}`);
  }));

program.parseAsync(process.argv).catch((error: unknown) => {
  handleError(error);
});

interface ConnOptions {
  conn: string;
}

interface PlanOptions extends ConnOptions {
  template: string;
}

interface ApplyOptions extends ConnOptions {
  plan: string;
  allowProd: boolean;
  dryRun: boolean;
}

interface ShowPlanOptions extends ConnOptions {
  plan: string;
  summary: boolean;
}

interface ResetOptions extends ConnOptions {
  dev: boolean;
}

interface ConnectOptions {
  type: "sqlite" | "postgres";
  database?: string;
  host?: string;
  port?: number;
  user?: string;
  passwordEnv?: string;
  mode: ConnectionMode;
}

function buildConnection(options: ConnectOptions): DbConnection {
  if (options.type === "sqlite") {
    if (!options.database) {
      throw new Error("SQLite connections require --database");
    }
    return {
      type: "sqlite",
      database: options.database,
      mode: options.mode,
    };
  }

  if (!options.database) {
    throw new Error("PostgreSQL connections require --database");
  }

  return {
    type: "postgres",
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    passwordEnv: options.passwordEnv,
    mode: options.mode,
  };
}

function parseConnectionType(value: string): "sqlite" | "postgres" {
  if (value === "sqlite" || value === "postgres") {
    return value;
  }
  throw new InvalidArgumentError("type must be sqlite or postgres");
}

function parseMode(value: string): ConnectionMode {
  if (value === "dev" || value === "test" || value === "prod") {
    return value;
  }
  throw new InvalidArgumentError("mode must be dev, test, or prod");
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError("port must be an integer between 1 and 65535");
  }
  return port;
}

function run<T extends unknown[]>(handler: (...args: T) => void | Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      handleError(error);
    }
  };
}

function handleError(error: unknown): void {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(`Error: ${String(error)}`);
  }
  process.exitCode = 1;
}
