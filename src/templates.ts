import type { Dialect } from "./types";

export const TEMPLATE_NAMES = ["ai-chat-app", "ai-image-app", "ai-agent-app"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

interface TemplateDefinition {
  name: TemplateName;
  tables: string[];
  sql: Record<Dialect, Record<string, string>>;
}

const commonSqlite = {
  users: `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  projects: `CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);`,
  model_calls: `CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);`,
  usage_records: `CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  model_call_id TEXT,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (model_call_id) REFERENCES model_calls(id)
);`,
  files: `CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  owner_user_id TEXT,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);`,
  audit_logs: `CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);`,
};

const commonPostgres = {
  users: `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  projects: `CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  model_calls: `CREATE TABLE IF NOT EXISTS model_calls (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_estimate NUMERIC,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  usage_records: `CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  user_id TEXT REFERENCES users(id),
  model_call_id TEXT REFERENCES model_calls(id),
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  files: `CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  owner_user_id TEXT REFERENCES users(id),
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  audit_logs: `CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
};

const templates: Record<TemplateName, TemplateDefinition> = {
  "ai-chat-app": {
    name: "ai-chat-app",
    tables: [
      "users",
      "projects",
      "conversations",
      "messages",
      "model_calls",
      "usage_records",
      "files",
      "audit_logs",
    ],
    sql: {
      sqlite: {
        users: commonSqlite.users,
        projects: commonSqlite.projects,
        conversations: `CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
        messages: `CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);`,
        model_calls: commonSqlite.model_calls,
        usage_records: commonSqlite.usage_records,
        files: commonSqlite.files,
        audit_logs: commonSqlite.audit_logs,
      },
      postgres: {
        users: commonPostgres.users,
        projects: commonPostgres.projects,
        conversations: `CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT REFERENCES users(id),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        messages: `CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        model_calls: commonPostgres.model_calls,
        usage_records: commonPostgres.usage_records,
        files: commonPostgres.files,
        audit_logs: commonPostgres.audit_logs,
      },
    },
  },
  "ai-image-app": {
    name: "ai-image-app",
    tables: [
      "users",
      "projects",
      "assets",
      "generation_tasks",
      "model_calls",
      "generation_results",
      "files",
      "usage_records",
      "audit_logs",
    ],
    sql: {
      sqlite: {
        users: commonSqlite.users,
        projects: commonSqlite.projects,
        assets: `CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_user_id TEXT,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime_type TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);`,
        generation_tasks: `CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
        generation_results: `CREATE TABLE IF NOT EXISTS generation_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  asset_id TEXT,
  model_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (model_call_id) REFERENCES model_calls(id)
);`,
        model_calls: commonSqlite.model_calls,
        files: commonSqlite.files,
        usage_records: commonSqlite.usage_records,
        audit_logs: commonSqlite.audit_logs,
      },
      postgres: {
        users: commonPostgres.users,
        projects: commonPostgres.projects,
        assets: `CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime_type TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        generation_tasks: `CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT REFERENCES users(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  settings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        generation_results: `CREATE TABLE IF NOT EXISTS generation_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES generation_tasks(id),
  asset_id TEXT REFERENCES assets(id),
  model_call_id TEXT REFERENCES model_calls(id),
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        model_calls: commonPostgres.model_calls,
        files: commonPostgres.files,
        usage_records: commonPostgres.usage_records,
        audit_logs: commonPostgres.audit_logs,
      },
    },
  },
  "ai-agent-app": {
    name: "ai-agent-app",
    tables: [
      "users",
      "projects",
      "agents",
      "tools",
      "agent_runs",
      "run_steps",
      "tool_calls",
      "memory_items",
      "artifacts",
      "audit_logs",
    ],
    sql: {
      sqlite: {
        users: commonSqlite.users,
        projects: commonSqlite.projects,
        agents: `CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);`,
        tools: `CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);`,
        agent_runs: `CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  input TEXT,
  output TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
        run_steps: `CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT,
  output TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id)
);`,
        tool_calls: `CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_step_id TEXT NOT NULL,
  tool_id TEXT,
  name TEXT NOT NULL,
  arguments TEXT,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_step_id) REFERENCES run_steps(id),
  FOREIGN KEY (tool_id) REFERENCES tools(id)
);`,
        memory_items: `CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);`,
        artifacts: `CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);`,
        audit_logs: commonSqlite.audit_logs,
      },
      postgres: {
        users: commonPostgres.users,
        projects: commonPostgres.projects,
        agents: `CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  instructions TEXT,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        tools: `CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        agent_runs: `CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued',
  input JSONB,
  output JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        run_steps: `CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        tool_calls: `CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_step_id TEXT NOT NULL REFERENCES run_steps(id),
  tool_id TEXT REFERENCES tools(id),
  name TEXT NOT NULL,
  arguments JSONB,
  result JSONB,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        memory_items: `CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_id TEXT REFERENCES agents(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        artifacts: `CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
        audit_logs: commonPostgres.audit_logs,
      },
    },
  },
};

export function getTemplate(name: string): TemplateDefinition {
  if (!isTemplateName(name)) {
    throw new Error(`Unknown template "${name}". Available templates: ${TEMPLATE_NAMES.join(", ")}`);
  }
  return templates[name];
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}
