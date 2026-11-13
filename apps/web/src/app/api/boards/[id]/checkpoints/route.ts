import { NextResponse } from "next/server";
import { getDatabase } from "@boardmind/ai-core";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: boardId } = await params;
    const db = getDatabase();

    const checkpoints = db.prepare(`
      SELECT id, board_id, label, snapshot_path, created_at
      FROM version_checkpoints
      WHERE board_id = ?
      ORDER BY created_at DESC
    `).all(boardId);

    return NextResponse.json({ checkpoints });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
