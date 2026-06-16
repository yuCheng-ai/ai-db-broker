import fs from "node:fs";
import { aiDbPath, ensureDir } from "./paths";
import { redactSecrets } from "./security";

interface OperationLogEntry {
  timestamp: string;
  operation: string;
  connection?: string;
  mode?: string;
  details?: unknown;
}

export function logOperation(entry: Omit<OperationLogEntry, "timestamp">): void {
  ensureDir(aiDbPath("logs"));
  const line = JSON.stringify(redactSecrets({ timestamp: new Date().toISOString(), ...entry }));
  fs.appendFileSync(aiDbPath("logs", "operations.log"), `${line}\n`, "utf8");
}
