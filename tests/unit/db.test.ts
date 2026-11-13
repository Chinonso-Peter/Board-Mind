import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { initSchema, getDatabase } from "../../packages/ai-core/src/db.js";
import { v4 as uuidv4 } from "uuid";

describe("SQLite Database Initialization & Schema", () => {
  const testDbPath = path.join(process.cwd(), "test_boardmind.sqlite");
  let db: Database.Database;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = getDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  });

  it("initializes tables with WAL mode and foreign keys enabled", () => {
    const journalMode = db.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("wal");

    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    expect(foreignKeys).toBe(1);
  });

  it("supports user creation and cascading board deletion", () => {
    const userId = uuidv4();
    const now = Date.now();

    // 1. Insert user
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, "engineer@example.com", "Alice Architect", "$2a$10$xyz", now);

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
    expect(user.email).toBe("engineer@example.com");

    // 2. Insert board
    const boardId = uuidv4();
    db.prepare(`
      INSERT INTO boards (id, name, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(boardId, "E-Commerce Microservices", userId, now, now);

    // 3. Insert board member
    db.prepare(`
      INSERT INTO board_members (board_id, user_id, role, added_at)
      VALUES (?, ?, ?, ?)
    `).run(boardId, userId, "owner", now);

    // 4. Delete user -> cascade deletes board and membership
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

    const boards = db.prepare(`SELECT * FROM boards WHERE id = ?`).all(boardId);
    expect(boards.length).toBe(0);

    const members = db.prepare(`SELECT * FROM board_members WHERE board_id = ?`).all(boardId);
    expect(members.length).toBe(0);
  });

  it("handles provider_usage upsert and reset correctly", () => {
    const today = new Date().toISOString().slice(0, 10);
    const upsert = db.prepare(`
      INSERT INTO provider_usage (provider_name, date, requests_used, tokens_used)
      VALUES (?, ?, 1, 350)
      ON CONFLICT(provider_name, date) DO UPDATE SET
        requests_used = requests_used + 1,
        tokens_used = tokens_used + excluded.tokens_used
    `);

    upsert.run("groq", today);
    upsert.run("groq", today);

    const row = db.prepare(`SELECT * FROM provider_usage WHERE provider_name = ? AND date = ?`).get("groq", today) as any;
    expect(row.requests_used).toBe(2);
    expect(row.tokens_used).toBe(700);
  });
});
