import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

// Standard SQL only, so the schema ports to PostgreSQL (SRS 2.4) by swapping
// TEXT JSON columns for JSONB and INTEGER booleans for BOOLEAN.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('LEARNER','MENTOR','ADMIN')),
  language TEXT NOT NULL DEFAULT 'en',
  skills TEXT NOT NULL DEFAULT '[]',
  expertise TEXT NOT NULL DEFAULT '[]',
  capacity INTEGER NOT NULL DEFAULT 5,
  portfolio_public INTEGER NOT NULL DEFAULT 0,
  portfolio_slug TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('AGRICULTURE','HEALTH','EDUCATION','ICT')),
  difficulty INTEGER NOT NULL DEFAULT 2,
  duration_weeks INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','LIVE','ARCHIVED')),
  skills TEXT NOT NULL DEFAULT '[]',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  criteria TEXT NOT NULL,
  UNIQUE (challenge_id, sequence)
);
CREATE TABLE IF NOT EXISTS enrolments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  current_stage INTEGER NOT NULL DEFAULT 1,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','WITHDRAWN')),
  enrolled_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, challenge_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, stage_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  enrolment_id TEXT NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  file_path TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','CHANGES_REQUESTED','APPROVED')),
  submitted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  mentor_id TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DONE','REASSIGNED')),
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  warned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  mentor_id TEXT NOT NULL REFERENCES users(id),
  strengths TEXT NOT NULL,
  improvements TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  criteria_met INTEGER NOT NULL,
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES submissions(id),
  badge_name TEXT NOT NULL,
  milestone TEXT NOT NULL,
  jwt TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PRE','POST')),
  confidence_score REAL NOT NULL,
  answers TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE (user_id, type)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assign_mentor ON assignments(mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_sub_enrol ON submissions(enrolment_id);
CREATE INDEX IF NOT EXISTS idx_notif_pending ON notifications(status, next_attempt_at);
`;

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.raw.exec(SCHEMA);
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }

  insert(table: string, row: Record<string, SQLInputValue>) {
    const cols = Object.keys(row);
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    this.raw.prepare(sql).run(...cols.map((c) => row[c]));
  }

  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }
}

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const json = <T>(text: unknown, fallback: T): T => {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

let instance: Db | undefined;
export const db = () => (instance ??= new Db(config.dbPath));
export const setDb = (d: Db) => {
  instance = d;
};
