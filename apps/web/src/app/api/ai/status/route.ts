import { NextResponse } from "next/server";
import { getDatabase, LLMRouter } from "@boardmind/ai-core";

export async function GET() {
  try {
    const db = getDatabase();
    const router = new LLMRouter(db);
    const providers = router.getStatus();

    return NextResponse.json({
      providers,
      sessionProposalsRemaining: 50,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
