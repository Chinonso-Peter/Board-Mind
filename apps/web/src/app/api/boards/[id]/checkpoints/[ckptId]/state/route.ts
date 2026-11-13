import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDatabase } from "@boardmind/ai-core";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; ckptId: string }> }
) {
  try {
    const { id: boardId, ckptId } = await params;
    const db = getDatabase();

    const ckpt = db.prepare(`
      SELECT snapshot_path FROM version_checkpoints
      WHERE id = ? AND board_id = ?
    `).get(ckptId, boardId) as { snapshot_path: string } | undefined;

    if (!ckpt) {
      return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
    }

    const dataDir = process.env.DATA_DIR || "/data";
    // Check local snapshot file path
    const filePath = path.isAbsolute(ckpt.snapshot_path)
      ? ckpt.snapshot_path
      : path.join(dataDir, ckpt.snapshot_path);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Snapshot file missing on disk" }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
