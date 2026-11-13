import { NextResponse } from "next/server";
import { getDatabase } from "@boardmind/ai-core";
import fs from "fs";
import path from "path";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDatabase();

    const board = db.prepare(`SELECT * FROM boards WHERE id = ?`).get(id) as any;
    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    const members = db.prepare(`
      SELECT m.user_id, m.role, u.name, u.email
      FROM board_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.board_id = ?
    `).all(id);

    return NextResponse.json({ board: { ...board, members } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDatabase();

    const board = db.prepare(`SELECT id, name FROM boards WHERE id = ?`).get(id) as any;
    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Atomically purge all board relational records
    db.transaction(() => {
      db.prepare(`DELETE FROM board_snapshots WHERE board_id = ?`).run(id);
      db.prepare(`DELETE FROM ai_proposals WHERE board_id = ?`).run(id);
      db.prepare(`DELETE FROM version_checkpoints WHERE board_id = ?`).run(id);
      db.prepare(`DELETE FROM board_members WHERE board_id = ?`).run(id);
      db.prepare(`DELETE FROM boards WHERE id = ?`).run(id);
    })();

    // Clean up filesystem snapshots
    try {
      const snapshotsDir = path.join(process.cwd(), "data", "boards", id);
      if (fs.existsSync(snapshotsDir)) {
        fs.rmSync(snapshotsDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore FS cleanup errors
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
