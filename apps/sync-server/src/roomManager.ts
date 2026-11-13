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
import { AgentPipeline, LLMRouter, createSeedDiagram } from "@boardmind/ai-core";
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
  isBoardCleared?: boolean;
  deletedElementIds?: Set<string>;
}

export class RoomManager {
  private rooms = new Map<string, RoomContext>();
  private persistenceInterval: NodeJS.Timeout;

  constructor(
    private snapshotStorage: SnapshotStorage,
    private agentPipeline: AgentPipeline,
    private router?: LLMRouter
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
      const hasSnapshot = this.snapshotStorage.loadRoomStateFromDb(boardId, doc);

      // Ensure standard schema structures
      const elementsArray = doc.getArray("elements");
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

      // If board is brand new and has never been snapshotted, auto-seed with canonical architecture diagram
      if (!hasSnapshot && elementsArray.length === 0 && !meta.get("initialized")) {
        meta.set("initialized", true);
        const seedElements = createSeedDiagram();
        doc.transact(() => {
          for (const el of seedElements) {
            elementsArray.push([el]);
          }
        });
        this.snapshotStorage.saveRoomStateToDb(boardId, doc);
      }

      const roomConns = new Map<WebSocket, { userId: string; role: "owner" | "editor" | "viewer"; userName?: string }>();

      const newRoom: RoomContext = {
        boardId,
        doc,
        awareness,
        conns: roomConns,
        dirty: false,
        evaluatingAi: false,
        isBoardCleared: false,
      };

      // Anti-resurrection observer: if the board was cleared by AI deletion, prevent stale client updates from reviving old elements
      elementsArray.observe(() => {
        if (newRoom.isBoardCleared && elementsArray.length > 0) {
          doc.transact(() => {
            elementsArray.delete(0, elementsArray.length);
          }, "purge-resurrected");
        }
      });

      // Set up transcript observer for AI pipeline
      this.attachTranscriptObserver(newRoom);

      // Document changes broadcast to all clients in the room
      doc.on("update", (update: Uint8Array, origin: any) => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const msg = encoding.toUint8Array(encoder);

        for (const [conn] of roomConns.entries()) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(msg);
          }
        }
      });

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
      console.log(`[RoomManager] Transcript updated for board ${room.boardId}, turns: ${transcriptArray.length}`);
      if (room.aiDebounceTimer) {
        clearTimeout(room.aiDebounceTimer);
      }
      room.aiDebounceTimer = setTimeout(() => {
        this.processTranscriptBatch(room);
      }, 1200);
    });
  }

  private async processTranscriptBatch(room: RoomContext): Promise<void> {
    if (room.evaluatingAi) {
      console.log(`[RoomManager] Already evaluating AI for board ${room.boardId}, skipping`);
      return;
    }

    const transcriptArray = room.doc.getArray("transcript");
    const allTurns: TranscriptTurn[] = [];

    for (let i = 0; i < transcriptArray.length; i++) {
      const item: any = transcriptArray.get(i);
      const turnObj = typeof item?.toJSON === "function" ? item.toJSON() : item;
      allTurns.push(turnObj);
    }

    const unprocessed = allTurns.filter((t) => !t.processedByAgent);
    if (unprocessed.length === 0) {
      console.log(`[RoomManager] No unprocessed turns for board ${room.boardId}`);
      return;
    }

    console.log(`[RoomManager] Evaluating ${unprocessed.length} unprocessed turns for board ${room.boardId}`);

    const recent = allTurns.filter((t) => t.processedByAgent).slice(-8);

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

      console.log(`[RoomManager] AI evaluation result:`, {
        status: result.status,
        reason: result.reason,
        proposalId: result.proposalId,
        provider: result.providerUsed,
      });

      if (result.status === "proposed" && result.proposalId && result.mutations && result.ghostResult) {
        const proposalsMap = room.doc.getMap("proposals");
        const lastUserTurn = unprocessed[unprocessed.length - 1];
        const userPrompt = (lastUserTurn?.text || "").toLowerCase();

        const propRecord: ProposalRecord = {
          id: result.proposalId,
          status: "approved",
          decisionSummary: result.reason || "Architectural modification",
          confidence: result.confidence || 0.9,
          providerUsed: result.providerUsed || "groq",
          operationsJson: JSON.stringify(result.mutations),
          plannedMutationsJson: JSON.stringify(result.mutations),
          ghostElementsJson: "[]",
          createdAt: Date.now(),
          resolvedBy: lastUserTurn?.speakerId || "agent",
          resolvedAt: Date.now(),
        };

        const propMap = new Y.Map();
        for (const [k, v] of Object.entries(propRecord)) {
          propMap.set(k, v);
        }

        // Create rich AI response turn in chat describing the architecture breakdown
        let descriptiveText = "";

        const allMutationsAreDelete =
          Array.isArray(result.mutations) &&
          result.mutations.length > 0 &&
          result.mutations.every((m: any) => m.op === "delete");

        const isTotalClear =
          allMutationsAreDelete ||
          ((/\b(delete|dlete|clear|remove|purge|drop|wipe)\b/i.test(userPrompt)) &&
           (/\b(all|whole|architecture|architectural|diagram|board|design|everything|components|it)\b/i.test(userPrompt)));

        if (isTotalClear) {
          descriptiveText = `I deleted the architecture diagram, so the board is empty again. If you want to try a different version, describe what system you would like to design!`;
        } else if (userPrompt.includes("remove") || userPrompt.includes("delete") || userPrompt.includes("dlete")) {
          descriptiveText = `I've updated the architecture diagram on your whiteboard by removing the requested components.\n\n*(Auto-applied to whiteboard. You can undo or restore previous states anytime from the Checkpoints tab)*`;
        } else if (result.explanation && result.explanation.trim().length > 40) {
          descriptiveText = `${result.explanation.trim()}\n\n*(Drawn directly on your whiteboard. You can ask me to modify, connect new microservices, or delete components anytime!)*`;
        } else {
          // Extract generated node labels to synthesize a dynamic, domain-specific Miro-grade breakdown
          const nodeLabels = (result.ghostResult?.ghostElements || [])
            .filter((e: any) => e.type === "rectangle" || e.type === "ellipse")
            .map((e: any) => e.customData?.label || e.text)
            .filter(Boolean);

          const clientNodes = nodeLabels.filter((n: string) => /client|mobile|web|frontend|ui/i.test(n));
          const gatewayNodes = nodeLabels.filter((n: string) => /gateway|ingress|proxy|envoy|kong/i.test(n));
          const serviceNodes = nodeLabels.filter((n: string) => !/db|database|postgres|redis|cache|client|mobile|web|frontend|gateway|ingress|queue|kafka|broker/i.test(n));
          const queueNodes = nodeLabels.filter((n: string) => /queue|kafka|rabbitmq|sqs|event|pubsub|broker/i.test(n));
          const storageNodes = nodeLabels.filter((n: string) => /db|database|postgres|sql|mongo|dynamo|redis|cache|s3|storage/i.test(n));

          const cleanSystemTitle = (lastUserTurn?.text || "System")
            .replace(/\b(i want to|create|draw|design|build|architecture|for it|a good|system|diagram|please|can you|just)\b/gi, "")
            .trim()
            .replace(/^a\s+|^an\s+/i, "")
            .replace(/\b\w/g, (c) => c.toUpperCase()) || "System";

          let breakdown = `### ${cleanSystemTitle} Architecture\nI've drawn the complete ${cleanSystemTitle} architecture on your whiteboard as a structured left-to-right diagram.\n\n`;

          if (clientNodes.length > 0 && gatewayNodes.length > 0) {
            breakdown += `Web and mobile clients (${clientNodes.join(", ")}) route through the ${gatewayNodes[0]} for authentication, rate limiting, and traffic routing. `;
          } else if (clientNodes.length > 0) {
            breakdown += `Clients (${clientNodes.join(", ")}) communicate directly with the backend service layer. `;
          }

          if (serviceNodes.length > 0) {
            breakdown += `The domain logic is decomposed into dedicated microservices: **${serviceNodes.join("**, **")}** ensuring separation of concerns and independent elasticity. `;
          }

          if (queueNodes.length > 0) {
            breakdown += `Asynchronous workflows and high-volume event streams are decoupled using **${queueNodes.join("**, **")}**. `;
          }

          if (storageNodes.length > 0) {
            breakdown += `Persistence and caching are distributed across **${storageNodes.join("**, **")}** to guarantee sub-millisecond retrieval alongside durable transactional consistency. `;
          }

          breakdown += `\n\n*(Drawn directly on your whiteboard. You can ask me to modify, connect new microservices, or delete components anytime!)*`;
          descriptiveText = breakdown;
        }

        const aiTurnMap = new Y.Map();
        aiTurnMap.set("id", `turn_ai_${Date.now()}`);
        aiTurnMap.set("speakerId", "agent_boardmind");
        aiTurnMap.set("speakerName", "BoardMind AI");
        aiTurnMap.set("text", descriptiveText);
        aiTurnMap.set("timestamp", Date.now());
        aiTurnMap.set("source", "agent");
        aiTurnMap.set("processedByAgent", true);

        room.doc.transact(() => {
          // DIRECT AGENT EXECUTION: Apply mutations immediately to whiteboard
          const elementsArray = room.doc.getArray("elements");

          if (isTotalClear) {
            room.isBoardCleared = true;
            elementsArray.delete(0, elementsArray.length);
          } else {
            if (result.mutations?.some((m: any) => m.op === "add")) {
              room.isBoardCleared = false;
            }
            for (const mut of (result.mutations || [])) {
              if (mut.op === "add") {
                elementsArray.push([mut.element]);
              } else if (mut.op === "delete") {
                for (let i = elementsArray.length - 1; i >= 0; i--) {
                  const item: any = elementsArray.get(i);
                  const rawEl = typeof item?.toJSON === "function" ? item.toJSON() : item;
                  if (rawEl && rawEl.id === mut.elementId) {
                    elementsArray.delete(i, 1);
                  }
                }
              } else if (mut.op === "update") {
                for (let i = 0; i < elementsArray.length; i++) {
                  const item: any = elementsArray.get(i);
                  const rawEl = typeof item?.toJSON === "function" ? item.toJSON() : item;
                  if (rawEl && rawEl.id === mut.elementId) {
                    const updated = { ...rawEl };
                    for (const [pk, pv] of Object.entries(mut.patch)) {
                      if (pk === "appendBoundElement") {
                        const existingBounds = Array.isArray(updated.boundElements) ? updated.boundElements : [];
                        updated.boundElements = [...existingBounds, pv];
                      } else {
                        updated[pk] = pv;
                      }
                    }
                    elementsArray.delete(i, 1);
                    elementsArray.insert(i, [updated]);
                  }
                }
              }
            }
          }

          propRecord.status = "approved";
          propRecord.resolvedBy = lastUserTurn?.speakerId || "agent";
          propRecord.resolvedAt = Date.now();
          for (const [k, v] of Object.entries(propRecord)) {
            propMap.set(k, v);
          }
          proposalsMap.set(result.proposalId!, propMap);

          transcriptArray.push([aiTurnMap]);

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

        // Instant checkpoint snapshot for history & undo
        room.dirty = true;
        this.snapshotStorage.createCheckpoint(
          room.boardId,
          room.doc,
          `AI: ${result.reason?.slice(0, 40) || "System Design"}`,
          "ai_approved",
          lastUserTurn?.speakerId,
          result.proposalId
        );
        this.snapshotStorage.saveRoomStateToDb(room.boardId, room.doc);

        // Broadcast proposal created via awareness to avoid crashing y-websocket client binary decoder
        room.awareness.setLocalStateField("lastProposal", {
          proposalId: result.proposalId,
          centroid: result.ghostResult.centroid,
          timestamp: Date.now(),
        });
      } else {
        // Conversational AI response for questions or architecture discussion
        const lastUserTurn = unprocessed[unprocessed.length - 1];
        const userText = lastUserTurn?.text || "";

        let replyText = "";
        if (this.router) {
          try {
            // Include recent conversation context properly partitioned into user and assistant roles
            const historyMessages = recent.slice(-8).map((r) => {
              if (r.speakerId === "agent_boardmind") {
                return { role: "assistant" as const, content: r.text };
              }
              return { role: "user" as const, content: `${r.speakerName}: ${r.text}` };
            });

            const chatRes = await this.router.complete({
              jsonMode: false,
              messages: [
                {
                  role: "system",
                  content: `You are BoardMind AI, an elite Principal Systems Architect Whiteboard Copilot.
Current whiteboard components: ${rawElements.map((e) => e.customData?.label || e.text || e.id).filter(Boolean).slice(0, 20).join(", ") || "Empty canvas"}.

CRITICAL IDENTITY & DIRECT WHITEBOARD CAPABILITY:
- You ARE BoardMind AI, the visual systems architect copilot connected directly to this whiteboard canvas.
- You have direct tools to create, draw, modify, connect, and clear architectural diagrams on the whiteboard in real time.
- NEVER, under any circumstance, say:
  • "As an AI text model, I do not have a graphical interface"
  • "I cannot render pixels or shapes"
  • "I cannot physically draw a square"
  • "My previous responses were simulating the concept"
  • "I cannot interact with the whiteboard"
- When the user asks about designing any system (e.g. restaurant ordering, Uber, social network, e-commerce, banking, real-time gaming, financial ledger):
  • Break down the core architectural patterns (Event-Driven, CQRS, Microservices, Caching, Sharding).
  • Recommend the essential building blocks (Clients, API Gateway, Core Domain Microservices, Databases, Caches, Event Brokers).
  • Discuss real-world trade-offs (latency, scalability, data consistency, idempotency).
  • Tell the user clearly what you are drawing onto the whiteboard canvas.
- Keep paragraphs structured, technical, clear, and engaging. Avoid robotic boilerplate.`,
                },
                ...historyMessages,
                { role: "user" as const, content: `${lastUserTurn?.speakerName || "Engineer"}: ${userText}` },
              ],
            });
            replyText = chatRes.content;
            if (replyText.startsWith("{") && replyText.includes("reason")) {
              try {
                const parsed = JSON.parse(replyText);
                if (parsed.reason) replyText = parsed.reason;
              } catch {
                // Keep raw text
              }
            }
          } catch (err: any) {
            console.error("[RoomManager] Chat completion error:", err.message);
            replyText = `I analyzed your design remark: "${userText}". To compile changes to the whiteboard, mention components or say "draw this architecture" (e.g. "Add a Redis cache before PostgreSQL", "Add a Kafka message queue", or "Draw the Uber architecture").`;
          }
        } else {
          replyText = `I analyzed your design remark: "${userText}". To compile changes to the whiteboard, mention components or say "draw this architecture" (e.g. "Add a Redis cache before PostgreSQL", "Add a Kafka message queue", or "Draw the Uber architecture").`;
        }
        
        const aiTurnMap = new Y.Map();
        aiTurnMap.set("id", `turn_ai_${Date.now()}`);
        aiTurnMap.set("speakerId", "agent_boardmind");
        aiTurnMap.set("speakerName", "BoardMind AI");
        aiTurnMap.set("text", replyText);
        aiTurnMap.set("timestamp", Date.now());
        aiTurnMap.set("source", "agent");
        aiTurnMap.set("processedByAgent", true);

        room.doc.transact(() => {
          transcriptArray.push([aiTurnMap]);
          for (let i = 0; i < transcriptArray.length; i++) {
            const item: any = transcriptArray.get(i);
            const id = item?.get ? item.get("id") : item?.id;
            if (unprocessed.some((u) => u.id === id)) {
              if (item?.set) item.set("processedByAgent", true);
            }
          }
        });

        if (result.status === "rejected_validation") {
          room.awareness.setLocalStateField("aiNotice", {
            level: "warn",
            message: `AI skipped an invalid diagram edit: ${result.reason}`,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err: any) {
      console.warn(`[RoomManager] AI evaluation error: ${err.message}`);
    } finally {
      room.evaluatingAi = false;
      room.awareness.setLocalStateField("aiStatus", null);
    }
  }

  private broadcastControlMessage(room: RoomContext, msg: Record<string, any>): void {
    // Kept for backward compatibility but safe: send via awareness if needed
    if (msg.type === "PROPOSAL_CREATED") {
      room.awareness.setLocalStateField("lastProposal", msg);
    } else if (msg.type === "AI_NOTICE") {
      room.awareness.setLocalStateField("aiNotice", msg);
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
          elementsArray.push([mut.element]);
        } else if (mut.op === "delete") {
          for (let i = elementsArray.length - 1; i >= 0; i--) {
            const item: any = elementsArray.get(i);
            const rawEl = typeof item?.toJSON === "function" ? item.toJSON() : item;
            if (rawEl && rawEl.id === mut.elementId) {
              elementsArray.delete(i, 1);
            }
          }
        } else if (mut.op === "update") {
          for (let i = 0; i < elementsArray.length; i++) {
            const item: any = elementsArray.get(i);
            const rawEl = typeof item?.toJSON === "function" ? item.toJSON() : item;
            if (rawEl && rawEl.id === mut.elementId) {
              const updated = { ...rawEl };
              for (const [pk, pv] of Object.entries(mut.patch)) {
                if (pk === "appendBoundElement") {
                  const existingBounds = Array.isArray(updated.boundElements) ? updated.boundElements : [];
                  updated.boundElements = [...existingBounds, pv];
                } else {
                  updated[pk] = pv;
                }
              }
              elementsArray.delete(i, 1);
              elementsArray.insert(i, [updated]);
            }
          }
        }
      }

      propMap.set("status", "approved");
      propMap.set("resolvedBy", userId);
      propMap.set("resolvedAt", Date.now());
    });

    room.dirty = true;
    this.snapshotStorage.saveRoomStateToDb(boardId, room.doc);

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
            if (!room.isBoardCleared) {
              syncProtocol.readSyncStep2(decoder, room.doc, ws);
              room.dirty = true;
            }
          }
        } else if (syncType === syncProtocol.messageYjsUpdate) {
          if (role !== "viewer") {
            if (room.isBoardCleared) {
              // Stale un-refreshed client trying to push old scene back while board is cleared: reject update and enforce empty state
              const replyEncoder = encoding.createEncoder();
              encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
              syncProtocol.writeSyncStep1(replyEncoder, room.doc);
              ws.send(encoding.toUint8Array(replyEncoder));
            } else {
              syncProtocol.readUpdate(decoder, room.doc, ws);
              room.dirty = true;
            }
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
