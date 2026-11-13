import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: boardId } = await params;
    const { format = "png", dataBase64 = "" } = await req.json();

    const dataDir = process.env.DATA_DIR || "/data";
    const exportsDir = path.join(dataDir, "boards", boardId, "exports");
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `${timestamp}_export.${format}`;
    const fullPath = path.join(exportsDir, filename);

    const buffer = Buffer.from(dataBase64, "base64");
    fs.writeFileSync(fullPath, buffer);

    const downloadUrl = `/data/boards/${boardId}/exports/${filename}`;

    return NextResponse.json({
      path: fullPath,
      downloadUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
