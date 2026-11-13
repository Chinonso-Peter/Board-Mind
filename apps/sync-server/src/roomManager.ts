import { WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import type {
  ExcalidrawElement,
  PlannedMutation,
  ProposalRecord,
  TranscriptTurn,
} from "@boardmind/ai-core";
import { AgentPipeline } from "@boardmind/ai-core";
import { SnapshotStorage } from "./snapshotStorage.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface RoomContext {
  boardId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, { userId: string; role: "owner" | "editor" | "viewer"; userName?: string }>;
  dirty: boolean;
  evaluatingAi: boolean;
  aiDebounceTimer?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
}

export class RoomManager {
  private rooms = new Map<string, RoomContext>();
  private persistenceInterval: NodeJS.Timeout;

  constructor(
    private snapshotStorage: SnapshotStorage,
    private agentPipeline: AgentPipeline
  ) {
    // 30s debounced SQLite Snapshot Writer loop
    this.persistenceInterval = setInterval(() => {
      this.flushDirtyRooms();
    }, 30_000);
  }

  stop(): void {
    clearInterval(this.persistenceInterval);
    this.flushDirtyRooms();
  }

  public flushDirtyRooms(): void {
    for (const [boardId, room] of this.rooms.entries()) {
      if (room.dirty) {
        this.snapshotStorage.saveRoomStateToDb(boardId, room.doc);
        room.dirty = false;
      }
    }
  }

  getRoom(boardId: string): RoomContext {
    let room = this.rooms.get(boardId);
    if (!room) {
      const doc = new Y.Doc();
      const awareness = new awarenessProtocol.Awareness(doc);

      // Hydrate from SQLite if snapshot exists
      this.snapshotStorage.loadRoomStateFromDb(boardId, doc);

      // Ensure standard schema structures
      doc.getArray("elements");
      doc.getMap("appState");
      doc.getArray("transcript");
      doc.getMap("proposals");
      doc.getArray("checkpoints");
      const meta = doc.getMap("meta");
      if (!meta.get("boardId")) {
        meta.set("boardId", boardId);
        meta.set("schemaVersion", 1);
        meta.set("proposalsUsedInSession", 0);
      }

      const roomConns = new Map<WebSocket, { userId: string; role: "owner" | "editor" | "viewer"; userName?: string }>();

      const newRoom: RoomContext = {
        boardId,
        doc,
        awareness,
        conns: roomConns,
        dirty: false,
        evaluatingAi: false,
      };

      // Set up transcript observer for AI pipeline
      this.attachTranscriptObserver(newRoom);

      // Awareness changes broadcast
      awareness.on("update", ({ added, updated, removed }: any, origin: any) => {
        const changedClients = added.concat(updated).concat(removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
        );
        const msg = encoding.toUint8Array(encoder);

        for (const [conn] of roomConns.entries()) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(msg);
          }
        }
      });

      this.rooms.set(boardId, newRoom);
      room = newRoom;
    }

    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = undefined;
    }

    return room;
  }

  private attachTranscriptObserver(room: RoomContext): void {
    const transcriptArray = room.doc.getArray("transcript");
    transcriptArray.observe(() => {
      if (room.aiDebounceTimer) {
        clearTimeout(room.aiDebounceTimer);
      }
      room.aiDebounceTimer = setTimeout(() => {
        this.processTranscriptBatch(room);
      }, 4000);
    });
  }

  private async processTranscriptBatch(room: RoomContext): Promise<void> {
    if (room.evaluatingAi) return;

    const transcriptArray = room.doc.getArray("transcript");
    const allTurns: TranscriptTurn[] = [];

    for (let i = 0; i < transcriptArray.length; i++) {
      const item: any = transcriptArray.get(i);
      const turnObj = typeof item?.toJSON === "function" ? item.toJSON() : item;
      allTurns.push(turnObj);
    }

    const unprocessed = allTurns.filter((t) => !t.processedByAgent);
    if (unprocessed.length === 0) return;

    const recent = allTurns.filter((t) => t.processedByAgent).slice(-3);

    // Read current raw elements from Y.Array('elements')
    const elementsArray = room.doc.getArray("elements");
    const rawElements: ExcalidrawElement[] = [];
    for (let i = 0; i < elementsArray.length; i++) {
      const el: any = elementsArray.get(i);
      rawElements.push(typeof el?.toJSON === "function" ? el.toJSON() : el);
    }

    room.evaluatingAi = true;

    // Broadcast AI is thinking in awareness
    room.awareness.setLocalStateField("aiStatus", "analyzing");

    try {
      const result = await this.agentPipeline.evaluate({
        boardId: room.boardId,
        transcriptDelta: unprocessed,
        recentTurns: recent,
        rawElements,
      });

      if (result.status === "proposed" && result.proposalId && result.mutations && result.ghostResult) {
        const proposalsMap = room.doc.getMap("proposals");
        const propRecord: ProposalRecord = {
          id: result.proposalId,
          status: "pending",
          decisionSummary: result.reason || "Architectural modification",
          confidence: result.confidence || 0.9,
          providerUsed: result.providerUsed || "groq",
          operationsJson: JSON.stringify(result.mutations),
          plannedMutationsJson: JSON.stringify(result.mutations),
          ghostElementsJson: JSON.stringify(result.ghostResult.ghostElements),
          createdAt: Date.now(),
          resolvedBy: null,
          resolvedAt: null,
        };

        const propMap = new Y.Map();
        for (const [k, v] of Object.entries(propRecord)) {
          propMap.set(k, v);
        }

        room.doc.transact(() => {
          proposalsMap.set(result.proposalId!, propMap);

          // Mark turns processed
          for (let i = 0; i < transcriptArray.length; i++) {
            const item: any = transcriptArray.get(i);
            const id = item?.get ? item.get("id") : item?.id;
            if (unprocessed.some((u) => u.id === id)) {
              if (item?.set) item.set("processedByAgent", true);
            }
          }

          // Increment session counter
          const meta = room.doc.getMap("meta");
          const used = (meta.get("proposalsUsedInSession") as number) || 0;
          meta.set("proposalsUsedInSession", used + 1);
        });

        // Broadcast CONTROL_PROPOSE_DECISION (0x10)
        this.broadcastControlMessage(room, {
          type: "PROPOSAL_CREATED",
          proposalId: result.proposalId,
          centroid: result.ghostResult.centroid,
        });
      } else if (result.status === "rejected_validation") {
        this.broadcastControlMessage(room, {
          type: "AI_NOTICE",
          level: "warn",
          message: `AI skipped an invalid diagram edit: ${result.reason}`,
        });
      }
    } catch (err: any) {
      console.warn(`[RoomManager] AI evaluation error: ${err.message}`);
    } finally {
      room.evaluatingAi = false;
      room.awareness.setLocalStateField("aiStatus", null);
    }
  }

  private broadcastControlMessage(room: RoomContext, msg: Record<string, any>): void {
    const jsonStr = JSON.stringify(msg);
    for (const [conn] of room.conns.entries()) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(jsonStr);
      }
    }
  }

  // Handle user approval of proposal
  approveProposal(boardId: string, proposalId: string, userId: string): boolean {
    const room = this.getRoom(boardId);
    const proposalsMap = room.doc.getMap("proposals");
    const propMap = proposalsMap.get(proposalId) as Y.Map<any> | undefined;
    if (!propMap) return false;

    const plannedJson = propMap.get("plannedMutationsJson") as string;
    const mutations: PlannedMutation[] = JSON.parse(plannedJson || "[]");

    room.doc.transact(() => {
      // Apply mutations directly to Y.Array('elements')
      const elementsArray = room.doc.getArray("elements");

      for (const mut of mutations) {
        if (mut.op === "add") {
          const elMap = new Y.Map();
          for (const [k, v] of Object.entries(mut.element)) {
            elMap.set(k, v);
          }
          elementsArray.push([elMap]);
        } else if (mut.op === "delete") {
          for (let i = elementsArray.length - 1; i >= 0; i--) {
            const item: any = elementsArray.get(i);
            const id = item?.get ? item.get("id") : item?.id;
            if (id === mut.elementId) {
              elementsArray.delete(i, 1);
            }
          }
        } else if (mut.op === "update") {
          for (let i = 0; i < elementsArray.length; i++) {
            const item: any = elementsArray.get(i);
            const id = item?.get ? item.get("id") : item?.id;
            if (id === mut.elementId && item?.set) {
              for (const [pk, pv] of Object.entries(mut.patch)) {
                if (pk === "appendBoundElement") {
                  const existingBounds = (item.get("boundElements") as any[]) || [];
                  item.set("boundElements", [...existingBounds, pv]);
                } else {
                  item.set(pk, pv);
                }
              }
            }
          }
        }
      }

      propMap.set("status", "approved");
      propMap.set("resolvedBy", userId);
      propMap.set("resolvedAt", Date.now());
    });

    // Create Checkpoint snapshot
    const summary = (propMap.get("decisionSummary") as string) || "AI Proposal";
    this.snapshotStorage.createCheckpoint(
      boardId,
      room.doc,
      `Approved: ${summary.slice(0, 40)}`,
      "ai_approved",
      userId,
      proposalId
    );

    room.dirty = true;
    return true;
  }

  // Handle user dismissal of proposal
  dismissProposal(boardId: string, proposalId: string, userId: string): boolean {
    const room = this.getRoom(boardId);
    const proposalsMap = room.doc.getMap("proposals");
    const propMap = proposalsMap.get(proposalId) as Y.Map<any> | undefined;
    if (!propMap) return false;

    room.doc.transact(() => {
      propMap.set("status", "dismissed");
      propMap.set("resolvedBy", userId);
      propMap.set("resolvedAt", Date.now());
    });

    return true;
  }

  handleConnection(
    ws: WebSocket,
    boardId: string,
    userId: string,
    role: "owner" | "editor" | "viewer",
    userName?: string
  ): void {
    const room = this.getRoom(boardId);
    room.conns.set(ws, { userId, role, userName });

    // Step 1: Send server sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));

    // Send awareness states
    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    ws.on("message", (message: any, isBinary: boolean) => {
      if (!isBinary) {
        try {
          const payload = JSON.parse(message.toString());
          if (payload.type === "APPROVE_PROPOSAL" && payload.proposalId) {
            this.approveProposal(boardId, payload.proposalId, userId);
          } else if (payload.type === "DISMISS_PROPOSAL" && payload.proposalId) {
            this.dismissProposal(boardId, payload.proposalId, userId);
          }
        } catch {
          // Ignore
        }
        return;
      }

      const uint8 = new Uint8Array(
        Buffer.isBuffer(message) ? message : Buffer.from(message)
      );
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const syncType = decoding.readVarUint(decoder);
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);

        if (syncType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, replyEncoder, room.doc);
          if (encoding.length(replyEncoder) > 1) {
            ws.send(encoding.toUint8Array(replyEncoder));
          }
        } else if (syncType === syncProtocol.messageYjsSyncStep2) {
          if (role !== "viewer") {
            syncProtocol.readSyncStep2(decoder, room.doc, ws);
            room.dirty = true;
          }
        } else if (syncType === syncProtocol.messageYjsUpdate) {
          if (role !== "viewer") {
            syncProtocol.readUpdate(decoder, room.doc, ws);
            room.dirty = true;
          }
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          ws
        );
      }
    });

    ws.on("close", () => {
      room.conns.delete(ws);
      if (room.conns.size === 0) {
        // Schedule 15-minute idle eviction
        room.idleTimer = setTimeout(() => {
          this.snapshotStorage.saveRoomStateToDb(boardId, room.doc);
          this.rooms.delete(boardId);
        }, 15 * 60 * 1000);
      }
    });
  }
}
