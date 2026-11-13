import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../../packages/ai-core/src/circuitBreaker.js";

describe("CircuitBreaker State Machine", () => {
  it("starts in CLOSED state and allows attempts", () => {
    const cb = new CircuitBreaker("test-provider", { failureThreshold: 3, resetTimeout: 1000 });
    expect(cb.state).toBe("CLOSED");
    expect(cb.shouldAttempt()).toBe(true);
  });

  it("transitions to OPEN after 3 consecutive failures", () => {
    const cb = new CircuitBreaker("test-provider", { failureThreshold: 3, resetTimeout: 1000 });
    cb.recordFailure();
    expect(cb.state).toBe("CLOSED");
    cb.recordFailure();
    expect(cb.state).toBe("CLOSED");
    cb.recordFailure();
    expect(cb.state).toBe("OPEN");
    expect(cb.shouldAttempt()).toBe(false);
  });

  it("trips immediately on invalid key (401/403)", () => {
    const cb = new CircuitBreaker("test-provider", { failureThreshold: 3, resetTimeout: 1000 });
    cb.tripImmediately();
    expect(cb.state).toBe("OPEN");
    expect(cb.shouldAttempt()).toBe(false);
  });

  it("transitions to HALF_OPEN after resetTimeout elapsed", async () => {
    const cb = new CircuitBreaker("test-provider", { failureThreshold: 3, resetTimeout: 50 });
    cb.tripImmediately();
    expect(cb.shouldAttempt()).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    expect(cb.shouldAttempt()).toBe(true);
    expect(cb.state).toBe("HALF_OPEN");

    // Success in HALF_OPEN resets to CLOSED
    cb.recordSuccess();
    expect(cb.state).toBe("CLOSED");
    expect(cb.getFailures()).toBe(0);
  });
});
