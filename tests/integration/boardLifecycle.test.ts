import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import * as Y from "yjs";
import { getDatabase } from "../../packages/ai-core/src/db.js";
import { SnapshotStorage } from "../../apps/sync-server/src/snapshotStorage.js";

describe("Board Lifecycle & Checkpoint Scrubbing Integration", () => {
  const testDb = path.join(process.cwd(), "test_lifecycle.sqlite");
  const testData = path.join(process.cwd(), "test_lifecycle_data");
  let db: Database.Database;
  let storage: SnapshotStorage;

  beforeEach(() => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (!fs.existsSync(testData)) fs.mkdirSync(testData, { recursive: true });
    db = getDatabase(testDb);
    storage = new SnapshotStorage(db, testData);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (fs.existsSync(`${testDb}-wal`)) fs.unlinkSync(`${testDb}-wal`);
    if (fs.existsSync(`${testDb}-shm`)) fs.unlinkSync(`${testDb}-shm`);
    if (fs.existsSync(testData)) fs.rmSync(testData, { recursive: true, force: true });
  });

  it("creates binary checkpoint snapshot and restores live Y.Doc cleanly", () => {
    const boardId = "board_lifecycle_01";
    const initialDoc = new Y.Doc();

    // 1. Populate initial doc with an element
    const elementsArray = initialDoc.getArray("elements");
    const el1 = new Y.Map();
    el1.set("id", "srv_initial");
    el1.set("type", "rectangle");
    el1.set("x", 100);
    el1.set("y", 100);
    initialDoc.transact(() => {
      elementsArray.push([el1]);
    });

    // 2. Create checkpoint #1
    const ckpt1 = storage.createCheckpoint(
      boardId,
      initialDoc,
      "Version 1.0 Initial",
      "manual",
      "usr_alice"
    );
    expect(ckpt1.id).toBeDefined();
    expect(ckpt1.elementCount).toBe(1);

    // 3. Mutate doc further (Version 2.0)
    const el2 = new Y.Map();
    el2.set("id", "srv_secondary");
    el2.set("type", "rectangle");
    el2.set("x", 400);
    el2.set("y", 100);
    initialDoc.transact(() => {
      elementsArray.push([el2]);
    });
    expect(initialDoc.getArray("elements").length).toBe(2);

    // 4. Restore checkpoint #1 into the live doc
    const restoreResult = storage.restoreCheckpoint(boardId, ckpt1.id, initialDoc, "usr_alice");
    expect(restoreResult.restored).toBe(true);

    // 5. Verify the live doc has reverted back to 1 element
    const restoredElements = initialDoc.getArray("elements");
    expect(restoredElements.length).toBe(1);
    const item: any = restoredElements.get(0);
    expect(item.get("id")).toBe("srv_initial");
  });
});
