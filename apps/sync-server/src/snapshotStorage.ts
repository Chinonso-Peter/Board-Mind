import fs from "fs";
import path from "path";
import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import type { CheckpointRecord } from "@boardmind/ai-core";

export class SnapshotStorage {
  private baseDataDir: string;

  constructor(
    private db: any,
    baseDataDir = process.env.DATA_DIR || "/data"
  ) {
    this.baseDataDir = baseDataDir;
  }

  getBoardDir(boardId: string): string {
    const dir = path.join(this.baseDataDir, "boards", boardId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getSnapshotsDir(boardId: string): string {
    const dir = path.join(this.getBoardDir(boardId), "snapshots");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getAudioDir(boardId: string): string {
    const dir = path.join(this.getBoardDir(boardId), "transcripts", "audio");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getExportsDir(boardId: string): string {
    const dir = path.join(this.getBoardDir(boardId), "exports");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  ensureBoard(boardId: string): void {
    try {
      const exists = this.db.prepare(`SELECT id FROM boards WHERE id = ?`).get(boardId);
      if (!exists) {
        const now = Date.now();
        this.db.prepare(`
          INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at)
          VALUES ('system_owner', 'system@boardmind.local', 'System', 'n/a', ?)
        `).run(now);
        this.db.prepare(`
          INSERT OR IGNORE INTO boards (id, name, owner_id, created_at, updated_at)
          VALUES (?, 'Architecture Board', 'system_owner', ?, ?)
        `).run(boardId, now, now);
      }
    } catch {
      // Ignore
    }
  }

  // Periodic persistence of room Y.Doc state to SQLite board_snapshots
  saveRoomStateToDb(boardId: string, doc: Y.Doc): void {
    this.ensureBoard(boardId);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const sv = Buffer.from(Y.encodeStateVector(doc));
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO board_snapshots (board_id, yjs_state, state_vector, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(board_id) DO UPDATE SET
        yjs_state = excluded.yjs_state,
        state_vector = excluded.state_vector,
        updated_at = excluded.updated_at
    `);
    stmt.run(boardId, state, sv, now);
  }

  loadRoomStateFromDb(boardId: string, doc: Y.Doc): boolean {
    try {
      const stmt = this.db.prepare(
        `SELECT yjs_state FROM board_snapshots WHERE board_id = ?`
      );
      const row = stmt.get(boardId) as { yjs_state: Buffer } | undefined;
      if (row && row.yjs_state) {
        Y.applyUpdate(doc, new Uint8Array(row.yjs_state));
        return true;
      }
    } catch (err: any) {
      console.warn(`[SnapshotStorage] Load DB state failed: ${err.message}`);
    }
    return false;
  }

  // Version Checkpoint creation (binary file + SQLite row + Yjs checkpoint entry)
  createCheckpoint(
    boardId: string,
    doc: Y.Doc,
    label: string,
    trigger: "manual" | "ai_approved" | "session_start" = "manual",
    userId = "system",
    proposalId?: string | null
  ): CheckpointRecord {
    this.ensureBoard(boardId);
    const checkpointId = uuidv4();
    const snapshotsDir = this.getSnapshotsDir(boardId);
    const filename = `${checkpointId}.bin`;
    const fullPath = path.join(snapshotsDir, filename);
    const relPath = `/data/boards/${boardId}/snapshots/${filename}`;

    const binaryUpdate = Y.encodeStateAsUpdate(doc);
    fs.writeFileSync(fullPath, Buffer.from(binaryUpdate));

    const now = Date.now();
    const elementsArray = doc.getArray("elements");
    const elementCount = elementsArray.length;

    // 1. Write to SQLite
    const stmt = this.db.prepare(`
      INSERT INTO version_checkpoints (id, board_id, label, snapshot_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(checkpointId, boardId, label, relPath, now);

    // 2. Append to Y.Doc checkpoints array
    const checkpointsArray = doc.getArray("checkpoints");
    const ckptMap = new Y.Map();
    ckptMap.set("id", checkpointId);
    ckptMap.set("label", label);
    ckptMap.set("trigger", trigger);
    ckptMap.set("proposalId", proposalId ?? null);
    ckptMap.set("snapshotPath", relPath);
    ckptMap.set("elementCount", elementCount);
    ckptMap.set("createdAt", now);
    ckptMap.set("createdBy", userId);

    doc.transact(() => {
      checkpointsArray.push([ckptMap]);
    });

    return {
      id: checkpointId,
      boardId,
      label,
      trigger,
      proposalId: proposalId ?? null,
      snapshotPath: relPath,
      elementCount,
      createdAt: now,
      createdBy: userId,
    };
  }

  // Read raw binary checkpoint update for preview
  readCheckpointSnapshot(boardId: string, checkpointId: string): Buffer | null {
    const snapshotsDir = this.getSnapshotsDir(boardId);
    const fullPath = path.join(snapshotsDir, `${checkpointId}.bin`);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath);
    }
    return null;
  }

  // Restore live room Y.Doc from a checkpoint
  restoreCheckpoint(
    boardId: string,
    checkpointId: string,
    liveDoc: Y.Doc,
    userId: string
  ): { restored: boolean; newCheckpointId: string } {
    const buffer = this.readCheckpointSnapshot(boardId, checkpointId);
    if (!buffer) {
      throw new Error(`Checkpoint snapshot ${checkpointId} not found`);
    }

    // Temporary doc to read elements and appState from snapshot
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, new Uint8Array(buffer));

    const snapshotElements = tempDoc.getArray("elements").toJSON();
    const snapshotAppState = tempDoc.getMap("appState").toJSON();

    liveDoc.transact(() => {
      // Clear live elements and re-populate from snapshot
      const liveElements = liveDoc.getArray("elements");
      while (liveElements.length > 0) {
        liveElements.delete(0, 1);
      }
      for (const el of snapshotElements) {
        const elMap = new Y.Map();
        for (const [k, v] of Object.entries(el as Record<string, any>)) {
          elMap.set(k, v);
        }
        liveElements.push([elMap]);
      }

      // Restore appState
      const liveAppState = liveDoc.getMap("appState");
      for (const [k, v] of Object.entries(snapshotAppState)) {
        liveAppState.set(k, v);
      }
    });

    // Create a new checkpoint recording the restoration event
    const newCheckpoint = this.createCheckpoint(
      boardId,
      liveDoc,
      `Restored: Checkpoint ${checkpointId.slice(0, 8)}`,
      "manual",
      userId
    );

    this.saveRoomStateToDb(boardId, liveDoc);

    return { restored: true, newCheckpointId: newCheckpoint.id };
  }
}
