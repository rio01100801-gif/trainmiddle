/** スキーマDDL。複雑なネスト構造はJSONカラムで保持し、検索キー（日付等）は列に出す */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS athlete (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  date_start TEXT NOT NULL,
  priority TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date_start);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  is_fixed INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);

CREATE TABLE IF NOT EXISTS strength_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strength_date ON strength_sessions(date);

CREATE TABLE IF NOT EXISTS session_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  date TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_session ON session_results(session_id);
CREATE INDEX IF NOT EXISTS idx_results_date ON session_results(date);

CREATE TABLE IF NOT EXISTS daily_checks (
  date TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fitness_markers (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_markers_date ON fitness_markers(date);

CREATE TABLE IF NOT EXISTS cfe (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heat_blocks (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heat_entries (
  date TEXT NOT NULL,
  block_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (date, block_id)
);

CREATE TABLE IF NOT EXISTS injuries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  body_part TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_injuries_date ON injuries(date);

CREATE TABLE IF NOT EXISTS week_template (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_menus (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY,
  phrase TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS past_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS syncs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fit_imports (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  session_id TEXT,
  triggered_by TEXT,
  accepted INTEGER,
  reject_reason TEXT,
  json TEXT NOT NULL
);
`;
