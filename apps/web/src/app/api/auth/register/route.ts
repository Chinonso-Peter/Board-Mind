import { NextResponse } from "next/server";
import { getDatabase, hashPassword } from "@boardmind/ai-core";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  try {
    const { email, name, password } = await req.json();

    if (!email || !name || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const db = getDatabase();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ? COLLATE NOCASE`).get(email);
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const userId = uuidv4();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase().trim(), name.trim(), passwordHash, now);

    return NextResponse.json(
      { user: { id: userId, email: email.toLowerCase().trim(), name: name.trim() } },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
