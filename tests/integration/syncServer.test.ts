import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import { createSyncServer, type SyncServerInstance } from "../../apps/sync-server/src/server.js";
import { generateWsToken } from "../../packages/ai-core/src/authUtils.js";
import fs from "fs";
import path from "path";

describe("Sync Server WebSocket & Yjs Protocol Integration", () => {
  const testDb = path.join(process.cwd(), "test_sync_int.sqlite");
  const testData = path.join(process.cwd(), "test_data_int");
  let serverInstance: SyncServerInstance;
  const PORT = 4888;

  beforeAll(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (!fs.existsSync(testData)) fs.mkdirSync(testData, { recursive: true });

    serverInstance = createSyncServer({
      port: PORT,
      sqlitePath: testDb,
      dataDir: testData,
      jwtSecret: "test-secret-key-boardmind-123",
    });
    await serverInstance.start();
  });

  afterAll(async () => {
    await serverInstance.stop();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (fs.existsSync(`${testDb}-wal`)) fs.unlinkSync(`${testDb}-wal`);
    if (fs.existsSync(`${testDb}-shm`)) fs.unlinkSync(`${testDb}-shm`);
    if (fs.existsSync(testData)) fs.rmSync(testData, { recursive: true, force: true });
  });

  it("responds to /health HTTP check with healthy status", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("healthy");
    expect(Array.isArray(data.providers)).toBe(true);
  });

  it("completes Yjs SyncStep1 and SyncStep2 exchange over WebSocket", async () => {
    const boardId = "test_board_room_1";
    const token = generateWsToken(
      { userId: "usr_alice", boardId, role: "editor" },
      "test-secret-key-boardmind-123"
    );

    const wsUrl = `ws://127.0.0.1:${PORT}/ws/sync/${boardId}?token=${token}`;
    const ws = new WebSocket(wsUrl);

    const clientDoc = new Y.Doc();

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        // Send client SyncStep1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
        syncProtocol.writeSyncStep1(encoder, clientDoc);
        ws.send(encoding.toUint8Array(encoder));
      });

      ws.on("message", (data: Buffer) => {
        const uint8 = new Uint8Array(data);
        const decoder = decoding.createDecoder(uint8);
        const msgType = decoding.readVarUint(decoder);

        if (msgType === 0) {
          // MESSAGE_SYNC
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            // Reply with client SyncStep2
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, 0);
            syncProtocol.writeSyncStep2(reply, clientDoc);
            ws.send(encoding.toUint8Array(reply));
          } else if (syncType === syncProtocol.messageYjsSyncStep2) {
            syncProtocol.readSyncStep2(decoder, clientDoc, null);
            ws.close();
            resolve();
          }
        }
      });

      ws.on("error", reject);
      setTimeout(() => reject(new Error("WebSocket timeout")), 4000);
    });
  });

  it("handles AI proposal approval and checkpoint generation", () => {
    const boardId = "test_board_approval";
    const room = serverInstance.roomManager.getRoom(boardId);

    // Add a proposal to the room doc
    const proposalsMap = room.doc.getMap("proposals");
    const propMap = new Y.Map();
    propMap.set("id", "prop_approve_test");
    propMap.set("status", "pending");
    propMap.set("decisionSummary", "Add Redis Cache");
    propMap.set(
      "plannedMutationsJson",
      JSON.stringify([
        {
          op: "add",
          elementId: "node_redis_approved",
          element: {
            id: "node_redis_approved",
            type: "rectangle",
            x: 100,
            y: 100,
            width: 180,
            height: 80,
            backgroundColor: "#fff3bf",
            customData: { label: "Redis Cache" },
          },
        },
      ])
    );
    room.doc.transact(() => {
      proposalsMap.set("prop_approve_test", propMap);
    });

    // Approve the proposal
    const approved = serverInstance.roomManager.approveProposal(
      boardId,
      "prop_approve_test",
      "usr_reviewer"
    );
    expect(approved).toBe(true);

    // Verify canonical elements array contains the approved element
    const elements = room.doc.getArray("elements");
    expect(elements.length).toBeGreaterThan(0);
    const added = elements.get(0) as any;
    expect(added.get("id")).toBe("node_redis_approved");

    // Verify checkpoint was created
    const checkpoints = room.doc.getArray("checkpoints");
    expect(checkpoints.length).toBeGreaterThan(0);
    const ckpt = checkpoints.get(0) as any;
    expect(ckpt.get("trigger")).toBe("ai_approved");
    expect(ckpt.get("createdBy")).toBe("usr_reviewer");
  });
});
