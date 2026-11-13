import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type {
  UserRecord,
  BoardRecord,
  BoardMemberRecord,
  ProviderUsageRecord,
} from "./types.js";

function getDefaultSqlitePath(): string {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  try {
    if (fs.existsSync("/data")) {
      fs.accessSync("/data", fs.constants.W_OK);
      return "/data/db/boardmind.sqlite";
    }
  } catch {
    // Fall back to local data dir
  }
  return path.join(process.cwd(), "data", "db", "boardmind.sqlite");
}

export function getDatabase(dbPath = getDefaultSqlitePath()): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  initSchema(db);
  return db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    -- 1. Users (Local NextAuth Credentials)
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    -- 2. Boards
    CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 3. Board Members (RBAC)
    CREATE TABLE IF NOT EXISTS board_members (
        board_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        added_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, user_id),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 4. Latest Yjs Binary State per Board (30s periodic & mutation flush)
    CREATE TABLE IF NOT EXISTS board_snapshots (
        board_id TEXT PRIMARY KEY NOT NULL,
        yjs_state BLOB NOT NULL,
        state_vector BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    -- 5. AI Proposals Audit & Analytics Log
    CREATE TABLE IF NOT EXISTS ai_proposals (
        id TEXT PRIMARY KEY NOT NULL,
        board_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'dismissed', 'rejected_validation')),
        input_transcript TEXT NOT NULL,
        output_ops TEXT NOT NULL,
        provider_used TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    -- 6. Version Checkpoints (Timeline Scrubbing)
    CREATE TABLE IF NOT EXISTS version_checkpoints (
        id TEXT PRIMARY KEY NOT NULL,
        board_id TEXT NOT NULL,
        label TEXT NOT NULL,
        snapshot_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    -- 7. Design Review Sessions
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        board_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        transcript_path TEXT NOT NULL,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    -- 8. Daily Free-Tier Provider Usage Tracker (Resets at 00:00 UTC)
    CREATE TABLE IF NOT EXISTS provider_usage (
        provider_name TEXT NOT NULL,
        date TEXT NOT NULL,
        requests_used INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_name, date)
    );

    -- Indexes for fast timeline, proposal, and membership lookups
    CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_proposals_board_created ON ai_proposals(board_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_board_created ON version_checkpoints(board_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_sessions_board ON sessions(board_id, started_at DESC);
  `);
}
