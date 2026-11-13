import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { MultiProviderVoiceAdapter } from "../../packages/ai-core/src/voiceAdapter.js";
import { UsageTracker } from "../../packages/ai-core/src/usageTracker.js";
import { initSchema } from "../../packages/ai-core/src/db.js";

describe("Voice Provider Adapter", () => {
  const testDbPath = path.join(process.cwd(), "test_voice.sqlite");
  let db: Database.Database;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  });

  it("filters silence and Whisper hallucinations", async () => {
    const tracker = new UsageTracker(db);
    const mock = async () => "Thank you.";

    const adapter = new MultiProviderVoiceAdapter(tracker, mock);
    const result = await adapter.transcribe(Buffer.from("dummy_audio_bytes"), "audio/webm");

    // "Thank you." is a known hallucination and should be filtered to empty text
    expect(result.text).toBe("");
  });

  it("returns legitimate transcribed text through mock", async () => {
    const tracker = new UsageTracker(db);
    const mock = async () => "We need to put a cache between the service and Postgres";

    const adapter = new MultiProviderVoiceAdapter(tracker, mock);
    const result = await adapter.transcribe(Buffer.from("dummy_audio_bytes"), "audio/webm");

    expect(result.text).toBe("We need to put a cache between the service and Postgres");
    expect(result.provider).toBe("fallback-whisper");
  });
});
