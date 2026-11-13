import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import * as Y from "yjs";
import { getDatabase } from "@boardmind/ai-core";
import { v4 as uuidv4 } from "uuid";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ckptId: string }> }
) {
  try {
    const { id: boardId, ckptId } = await params;
    const db = getDatabase();

    const ckpt = db.prepare(`
      SELECT snapshot_path, label FROM version_checkpoints
      WHERE id = ? AND board_id = ?
    `).get(ckptId, boardId) as { snapshot_path: string; label: string } | undefined;

    if (!ckpt) {
      return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
    }

    const dataDir = process.env.DATA_DIR || "/data";
    const filePath = path.isAbsolute(ckpt.snapshot_path)
      ? ckpt.snapshot_path
      : path.join(dataDir, ckpt.snapshot_path);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Snapshot file missing" }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);

    // Update SQLite latest snapshot
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(buffer));
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(doc));
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    const now = Date.now();

    db.prepare(`
      INSERT INTO board_snapshots (board_id, yjs_state, state_vector, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(board_id) DO UPDATE SET
        yjs_state = excluded.yjs_state,
        state_vector = excluded.state_vector,
        updated_at = excluded.updated_at
    `).run(boardId, yjsState, stateVector, now);

    // Create a new checkpoint recording restoration
    const newCkptId = uuidv4();
    const newFileName = `${newCkptId}.bin`;
    const newSnapDir = path.join(dataDir, "boards", boardId, "snapshots");
    if (!fs.existsSync(newSnapDir)) fs.mkdirSync(newSnapDir, { recursive: true });

    fs.writeFileSync(path.join(newSnapDir, newFileName), yjsState);

    const relPath = `/data/boards/${boardId}/snapshots/${newFileName}`;
    db.prepare(`
      INSERT INTO version_checkpoints (id, board_id, label, snapshot_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newCkptId, boardId, `Restored: ${ckpt.label}`, relPath, now);

    return NextResponse.json({
      restored: true,
      newCheckpointId: newCkptId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
