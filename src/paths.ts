import fs from "node:fs";
import path from "node:path";

export const AI_DB_DIR = ".ai-db";
export const CONFIG_FILE = "config.json";

export function projectRoot(): string {
  return process.cwd();
}

export function projectPath(...parts: string[]): string {
  return path.resolve(projectRoot(), ...parts);
}

export function aiDbPath(...parts: string[]): string {
  return projectPath(AI_DB_DIR, ...parts);
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function configPath(): string {
  return aiDbPath(CONFIG_FILE);
}

export function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function resolveProjectFile(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : projectPath(filePath);
}
