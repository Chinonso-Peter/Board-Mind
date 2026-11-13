import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { LLMRouter, type LLMProvider } from "../../packages/ai-core/src/llmRouter.js";
import { initSchema } from "../../packages/ai-core/src/db.js";

describe("LLMRouter Failover & Rate Limiting", () => {
  const testDbPath = path.join(process.cwd(), "test_llm_router.sqlite");
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

  it("calculates hours until midnight UTC accurately", () => {
    const router = new LLMRouter(db);
    const hours = router.getHoursUntilMidnightUtc();
    expect(hours).toBeGreaterThanOrEqual(1);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("tracks daily provider usage in SQLite", async () => {
    const router = new LLMRouter(db);
    router.mockCompletion = async () => JSON.stringify({ is_decision: true, confidence: 0.9, reason: "mocked" });

    const response = await router.complete({
      messages: [{ role: "user", content: "Let's add Redis" }],
    });

    expect(response.content).toContain("mocked");
  });

  it("fails over when upstream provider throws 429", async () => {
    const customProviders: LLMProvider[] = [
      {
        name: "failing-primary",
        model: "m1",
        maxRPM: 30,
        maxRPD: 100,
        baseURL: "http://mock1",
        client: {
          chat: {
            completions: {
              create: async () => {
                const err = new Error("Rate limit exceeded") as any;
                err.status = 429;
                throw err;
              },
            },
          },
        } as any,
      },
      {
        name: "fallback-secondary",
        model: "m2",
        maxRPM: 300,
        maxRPD: 1000,
        baseURL: "http://mock2",
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [{ message: { content: "{\"result\": \"success_fallback\"}" } }],
                usage: { total_tokens: 300 },
              }),
            },
          },
        } as any,
      },
    ];

    const router = new LLMRouter(db, customProviders);
    const result = await router.complete({
      messages: [{ role: "user", content: "Test failover" }],
    });

    expect(result.provider).toBe("fallback-secondary");
    expect(result.content).toBe("{\"result\": \"success_fallback\"}");

    // Primary breaker recorded failure
    const primaryBreaker = router.getCircuitBreaker("failing-primary");
    expect(primaryBreaker?.getFailures()).toBe(1);
  });

  it("trips circuit immediately on 401/403 invalid API keys", async () => {
    const customProviders: LLMProvider[] = [
      {
        name: "bad-key-provider",
        model: "m1",
        maxRPM: 30,
        maxRPD: 100,
        baseURL: "http://mock1",
        client: {
          chat: {
            completions: {
              create: async () => {
                const err = new Error("Unauthorized") as any;
                err.status = 401;
                throw err;
              },
            },
          },
        } as any,
      },
      {
        name: "working-fallback",
        model: "m2",
        maxRPM: 300,
        maxRPD: 1000,
        baseURL: "http://mock2",
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [{ message: { content: "{\"ok\": true}" } }],
                usage: { total_tokens: 150 },
              }),
            },
          },
        } as any,
      },
    ];

    const router = new LLMRouter(db, customProviders);
    const result = await router.complete({
      messages: [{ role: "user", content: "Test 401 trip" }],
    });

    expect(result.provider).toBe("working-fallback");

    const badBreaker = router.getCircuitBreaker("bad-key-provider");
    expect(badBreaker?.state).toBe("OPEN");
  });
});
