type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

export function assertNoPlaintextPassword(value: unknown, context: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextPassword(item, `${context}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === "password") {
      throw new Error(`${context} contains a forbidden plaintext password field`);
    }
    assertNoPlaintextPassword(nested, `${context}.${key}`);
  }
}

export function redactSecrets<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): JsonLike | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item) ?? null);
  }

  if (!value || typeof value !== "object") {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    return undefined;
  }

  const result: Record<string, JsonLike> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/password/i.test(key) && key !== "passwordEnv") {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = redact(nested) ?? null;
  }
  return result;
}

export function sanitizeMessage(message: string, secrets: string[] = []): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }
  }
  return sanitized;
}

export function assertSafeSql(sql: string): void {
  const stripped = stripSqlComments(sql);
  const upper = stripped.toUpperCase();

  if (/\bDROP\s+DATABASE\b/.test(upper)) {
    throw new Error("Refusing destructive SQL: DROP DATABASE is not allowed");
  }

  if (/\bDROP\s+TABLE\b/.test(upper)) {
    throw new Error("Refusing destructive SQL: DROP TABLE is not allowed");
  }

  if (/\bTRUNCATE\b/.test(upper)) {
    throw new Error("Refusing destructive SQL: TRUNCATE is not allowed");
  }

  for (const statement of splitStatements(stripped)) {
    if (/\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) {
      throw new Error("Refusing destructive SQL: DELETE without WHERE is not allowed");
    }
  }
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
