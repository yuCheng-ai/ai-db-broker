# AI DB Broker

`ai-db-broker` is a CLI-first local database broker for Codex and other AI coding tools. The npm binary is `ai-db`.

It lets AI coding tools operate databases through named connections without receiving database passwords.

It is not an MCP server, not a database client, not an HTTP service, and not a desktop app. It does not start a long-running process and does not listen on any port.

## Model

1. A human configures database connections in the project.
2. Configuration is stored in `.ai-db/config.json`.
3. Plaintext passwords are forbidden. PostgreSQL passwords must be referenced by environment variable name with `passwordEnv`.
4. AI tools operate only through connection names, for example `--conn local`.
5. Each CLI run loads config, connects temporarily, performs one operation, and exits.

## Quick Start

```bash
npm install
npm run build
```

Use the built CLI directly while developing:

```bash
npm run build
node dist/index.js --help
```

When installed as a package, the command is:

```bash
ai-db --help
```

## Basic Workflow

Run these commands from your project root.

```bash
# 1. Create local AI DB Broker files
node dist/index.js init

# 2. Register a human-approved connection
node dist/index.js connect local --type sqlite --database ./data/app.db --mode dev

# 3. Check local setup
node dist/index.js doctor --conn local

# 4. Pick a template
node dist/index.js templates

# 5. Inspect current schema only
node dist/index.js inspect --conn local

# 6. Create a plan for missing tables
node dist/index.js plan --conn local --template ai-chat-app

# 7. Review the generated SQL before applying
node dist/index.js plans --conn local
node dist/index.js show-plan --conn local --plan latest

# 8. Dry-run the apply
node dist/index.js apply --conn local --plan latest --dry-run

# 9. Apply the plan
node dist/index.js apply --conn local --plan latest

# 10. Backup when needed
node dist/index.js backup --conn local
```

## Initialize

`init` creates:

```text
.ai-db/
├── config.json
├── plans/
├── backups/
├── logs/
└── migrations/
```

Command:

```bash
ai-db init
```

## Configure Connections

SQLite:

```bash
ai-db connect local --type sqlite --database ./data/app.db --mode dev
```

PostgreSQL:

```bash
export PG_DEV_PASSWORD='your-password'
ai-db connect pg-dev \
  --type postgres \
  --host localhost \
  --port 5432 \
  --database my_app \
  --user postgres \
  --password-env PG_DEV_PASSWORD \
  --mode dev
```

AI tools should only receive the connection name, such as `local` or `pg-dev`. They should not receive passwords or raw DSNs.

Example `.ai-db/config.json`:

```json
{
  "version": 1,
  "connections": {
    "local": {
      "type": "sqlite",
      "database": "./data/app.db",
      "mode": "dev"
    },
    "pg-dev": {
      "type": "postgres",
      "host": "localhost",
      "port": 5432,
      "database": "my_app",
      "user": "postgres",
      "passwordEnv": "PG_DEV_PASSWORD",
      "mode": "dev"
    }
  }
}
```

## Commands

```bash
ai-db init
ai-db connect <name>
ai-db connections
ai-db doctor [--conn <name>]
ai-db inspect --conn <name>
ai-db templates
ai-db plan --conn <name> --template <template>
ai-db plans [--conn <name>]
ai-db show-plan --conn <name> --plan latest
ai-db apply --conn <name> --plan latest --dry-run
ai-db apply --conn <name> --plan latest
ai-db backup --conn <name>
ai-db reset --conn <name> --dev
```

Built-in templates:

```text
ai-chat-app
ai-image-app
ai-agent-app
```

Each template includes separate SQLite and PostgreSQL SQL definitions.

## Doctor

Use `doctor` before asking AI tools to operate on a database:

```bash
ai-db doctor
ai-db doctor --conn local
```

It checks:

- `.ai-db` directory structure
- config validity
- connection mode and type
- SQLite database path
- PostgreSQL `passwordEnv`
- PostgreSQL `pg_dump` availability for backup
- schema inspection connectivity when `--conn` is provided

## Planning and Applying

The first version intentionally avoids complex schema diffing:

- If a table does not exist, `plan` creates a statement for it.
- If a table exists, `plan` skips it.
- It does not drop tables, drop columns, or change column types.

Example:

```bash
ai-db inspect --conn local
ai-db plan --conn local --template ai-chat-app
ai-db show-plan --conn local --plan latest
ai-db apply --conn local --plan latest --dry-run
ai-db apply --conn local --plan latest
ai-db inspect --conn local
```

`show-plan` prints the SQL that will be executed. Use `--summary` to hide SQL and show only metadata:

```bash
ai-db show-plan --conn local --plan latest --summary
```

`apply --dry-run` validates the selected plan and safety rules, then exits without executing SQL.

## Backup

SQLite copies the database file:

```bash
ai-db backup --conn local
```

The backup is written to:

```text
.ai-db/backups/<conn>/<timestamp>.db
```

PostgreSQL calls the local `pg_dump` binary and writes a SQL backup. If `pg_dump` is not available on `PATH`, the CLI exits with a clear error.

## Reset

Reset drops all user tables and is intentionally restricted:

```bash
ai-db reset --conn local --dev
```

Rules:

- `--dev` is required.
- The connection mode must be `dev` or `test`.
- `prod` reset is always refused.

## Safety Boundary

- Plaintext `password` fields are rejected in config.
- Password values are never printed.
- `inspect` reads schema only and never reads business rows.
- `prod` is read-only by default.
- `apply` against `prod` is refused unless `--allow-prod` is passed.
- `apply --dry-run` validates a plan without executing SQL.
- Destructive SQL is refused by default:
  - `DROP DATABASE`
  - `DROP TABLE`
  - `TRUNCATE`
  - `DELETE FROM ...` without `WHERE`
- Write operations are logged to `.ai-db/logs/operations.log`.

## Rules for Codex and AI Tools

- Run database operations only through `ai-db`.
- Use connection names only, for example `--conn local`.
- Do not read or request raw passwords.
- Do not write plaintext passwords into `.ai-db/config.json`.
- Use `inspect` before planning changes.
- Use `plan`, then `show-plan`, then `apply --dry-run`, then `apply`.
- Do not run `apply` on `prod` unless a human explicitly approved `--allow-prod`.
- Do not run `reset` unless the connection is `dev` or `test` and the command includes `--dev`.

## How This Differs From DBHub

AI DB Broker is intentionally not DBHub.

- DBHub is a database MCP server.
- DBHub can run as an HTTP server and expose MCP/workbench endpoints.
- DBHub lets MCP clients execute SQL through tools such as `execute_sql`.
- AI DB Broker is a plain CLI. It runs one command, performs one operation, and exits.
- AI DB Broker does not start an MCP server, does not expose HTTP, and does not provide an arbitrary SQL client.

## Acceptance Flow

```bash
npm install
npm run build
node dist/index.js init
node dist/index.js connect local --type sqlite --database ./data/app.db --mode dev
node dist/index.js connections
node dist/index.js doctor --conn local
node dist/index.js inspect --conn local
node dist/index.js templates
node dist/index.js plan --conn local --template ai-chat-app
node dist/index.js plans --conn local
node dist/index.js show-plan --conn local --plan latest --summary
node dist/index.js apply --conn local --plan latest --dry-run
node dist/index.js apply --conn local --plan latest
node dist/index.js inspect --conn local
node dist/index.js backup --conn local
node dist/index.js reset --conn local --dev
```
