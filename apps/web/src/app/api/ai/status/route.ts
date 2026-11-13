import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:4000/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        providers: data.providers || [],
        sessionProposalsRemaining: 50,
        timestamp: Date.now(),
      });
    }
  } catch {}

  return NextResponse.json({
    providers: [
      { name: "groq", model: "qwen/qwen3.8-27b", circuit: "CLOSED", requestsToday: 1, maxRPD: 1000 },
    ],
    sessionProposalsRemaining: 50,
    timestamp: Date.now(),
  });
}
