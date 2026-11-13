import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  generateWsToken,
  verifyWsToken,
} from "../../packages/ai-core/src/authUtils.js";

describe("Auth Utils", () => {
  it("hashes and verifies passwords securely", async () => {
    const raw = "SuperSecretPassword123!";
    const hash = await hashPassword(raw);
    expect(hash).not.toBe(raw);
    expect(hash.startsWith("$2")).toBe(true);

    const valid = await verifyPassword(raw, hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword("WrongPassword", hash);
    expect(invalid).toBe(false);
  });

  it("generates and verifies short-lived WebSocket JWT tokens", () => {
    const payload = {
      userId: "user_uuid_1",
      boardId: "board_uuid_1",
      role: "editor" as const,
    };

    const token = generateWsToken(payload, "test-secret-key-12345");
    expect(typeof token).toBe("string");

    const decoded = verifyWsToken(token, "test-secret-key-12345");
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe("user_uuid_1");
    expect(decoded?.boardId).toBe("board_uuid_1");
    expect(decoded?.role).toBe("editor");

    const invalid = verifyWsToken(token, "wrong-secret-key");
    expect(invalid).toBeNull();
  });
});
