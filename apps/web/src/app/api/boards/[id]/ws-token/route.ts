import { NextResponse } from "next/server";
import { generateWsToken, getDatabase } from "@boardmind/ai-core";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: boardId } = await params;
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId") || "guest_user";
    const roleParam = url.searchParams.get("role") || "editor";

    const role = (["owner", "editor", "viewer"].includes(roleParam)
      ? roleParam
      : "editor") as "owner" | "editor" | "viewer";

    const token = generateWsToken({
      userId,
      boardId,
      role,
    });

    const expiresAt = Date.now() + 2 * 3600 * 1000;

    return NextResponse.json({
      token,
      expiresAt,
      role,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
