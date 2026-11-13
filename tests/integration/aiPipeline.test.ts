import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import {
  LLMRouter,
  AgentPipeline,
  getDatabase,
  createExcalidrawShape,
  type ExcalidrawElement,
} from "@boardmind/ai-core";

describe("AI Agent Pipeline End-to-End Integration", () => {
  const testDb = path.join(process.cwd(), "test_pipeline_int.sqlite");
  let db: Database.Database;

  beforeEach(() => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    db = getDatabase(testDb);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (fs.existsSync(`${testDb}-wal`)) fs.unlinkSync(`${testDb}-wal`);
    if (fs.existsSync(`${testDb}-shm`)) fs.unlinkSync(`${testDb}-shm`);
  });

  it("evaluates live design review turns and generates valid ghost proposal", async () => {
    const router = new LLMRouter(db);
    const pipeline = new AgentPipeline(router, db);

    const initialElements: ExcalidrawElement[] = [
      createExcalidrawShape({
        id: "api_service",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        backgroundColor: "#a5d8ff",
        strokeStyle: "solid",
        boundElements: [],
        customData: { bmKind: "node", label: "API Service", nodeType: "service" },
      }),
    ];

    const result = await pipeline.evaluate({
      boardId: "board_eval_1",
      transcriptDelta: [
        {
          id: "turn_1",
          speakerId: "usr_alice",
          speakerName: "Alice Architect",
          text: "Let's add a Redis Cache next to the API Service",
          timestamp: Date.now(),
          source: "voice",
          processedByAgent: false,
        },
      ],
      rawElements: initialElements,
    });

    expect(result.status).toBe("proposed");
    expect(result.proposalId).toBeDefined();
    expect(result.ghostResult).toBeDefined();
    expect(result.ghostResult?.ghostElements.length).toBeGreaterThan(0);

    // Verify ghost styling
    const ghost = result.ghostResult?.ghostElements[0];
    expect(ghost?.strokeStyle).toBe("dashed");
    expect(ghost?.strokeColor).toBe("#4f46e5");
    expect(ghost?.customData?.isGhost).toBe(true);

    // Verify SQLite ai_proposals persistence
    const saved = db
      .prepare(`SELECT * FROM ai_proposals WHERE id = ?`)
      .get(result.proposalId) as any;
    expect(saved).toBeDefined();
    expect(saved.status).toBe("pending");
  });

  it("gracefully detects non-decisions (small talk) without proposing mutations", async () => {
    const router = new LLMRouter(db);
    const pipeline = new AgentPipeline(router, db);

    const result = await pipeline.evaluate({
      boardId: "board_eval_2",
      transcriptDelta: [
        {
          id: "turn_2",
          speakerId: "usr_bob",
          speakerName: "Bob",
          text: "Can everyone hear me clearly? Let me check my audio settings.",
          timestamp: Date.now(),
          source: "voice",
          processedByAgent: false,
        },
      ],
      rawElements: [],
    });

    expect(result.status).toBe("no_decision");
    expect(result.proposalId).toBeUndefined();
  });
});
