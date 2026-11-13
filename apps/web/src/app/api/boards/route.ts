import { NextResponse } from "next/server";
import { getDatabase, type BoardRecord } from "@boardmind/ai-core";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: Request) {
  try {
    const db = getDatabase();
    // Return all boards with owner & member details
    const boards = db.prepare(`
      SELECT b.id, b.name, b.owner_id, b.created_at, b.updated_at,
             COUNT(m.user_id) as member_count
      FROM boards b
      LEFT JOIN board_members m ON b.id = m.board_id
      GROUP BY b.id
      ORDER BY b.updated_at DESC
    `).all();

    return NextResponse.json({ boards });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, ownerId = "system_owner" } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Board name is required" }, { status: 400 });
    }

    const db = getDatabase();
    const boardId = uuidv4();
    const now = Date.now();

    // Ensure owner exists
    const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(ownerId);
    if (!user) {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(ownerId, "system@boardmind.local", "System User", "n/a", now);
    }

    // Insert board
    db.prepare(`
      INSERT INTO boards (id, name, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(boardId, name.trim(), ownerId, now, now);

    // Add owner as board_member
    db.prepare(`
      INSERT INTO board_members (board_id, user_id, role, added_at)
      VALUES (?, ?, 'owner', ?)
    `).run(boardId, ownerId, now);

    return NextResponse.json(
      {
        board: {
          id: boardId,
          name: name.trim(),
          ownerId,
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
