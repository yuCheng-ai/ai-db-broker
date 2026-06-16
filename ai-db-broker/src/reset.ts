import { createAdapter } from "./db";
import { logOperation } from "./logger";
import type { DbConnection } from "./types";

export async function resetConnection(connectionName: string, connection: DbConnection, devFlag: boolean): Promise<string[]> {
  if (!devFlag) {
    throw new Error("reset requires explicit --dev");
  }
  if (connection.mode !== "dev" && connection.mode !== "test") {
    throw new Error("reset is only allowed for dev or test connections");
  }

  const adapter = createAdapter(connection, "write");
  try {
    await adapter.connect();
    const droppedTables = await adapter.reset();
    logOperation({
      operation: "reset",
      connection: connectionName,
      mode: connection.mode,
      details: { droppedTables },
    });
    return droppedTables;
  } finally {
    await adapter.disconnect();
  }
}
