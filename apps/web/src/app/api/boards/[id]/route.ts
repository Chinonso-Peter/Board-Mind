import { NextResponse } from "next/server";
import { getDatabase } from "@boardmind/ai-core";

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
