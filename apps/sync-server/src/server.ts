import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";
import {
  getDatabase,
  UsageTracker,
  LLMRouter,
  AgentPipeline,
  verifyWsToken,
  type WsTokenPayload,
} from "@boardmind/ai-core";
import { SnapshotStorage } from "./snapshotStorage.js";
import { RoomManager } from "./roomManager.js";
import { VoiceHandler } from "./voiceHandler.js";

export interface SyncServerConfig {
  port?: number;
  sqlitePath?: string;
  dataDir?: string;
  jwtSecret?: string;
  router?: LLMRouter;
}

export interface SyncServerInstance {
  server: http.Server;
  wss: WebSocketServer;
  db: any;
  router: LLMRouter;
  agentPipeline: AgentPipeline;
  roomManager: RoomManager;
  snapshotStorage: SnapshotStorage;
  voiceHandler: VoiceHandler;
  port: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

import fs from "fs";
import path from "path";

function getDefaultDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  try {
    if (fs.existsSync("/data")) {
      fs.accessSync("/data", fs.constants.W_OK);
      return "/data";
    }
  } catch {
    // Fall back to local data directory
  }
  return path.join(process.cwd(), "data");
}

export function createSyncServer(config: SyncServerConfig = {}): SyncServerInstance {
  const port = config.port ?? parseInt(process.env.SYNC_PORT || (process.env.PORT === "3000" ? "4000" : process.env.PORT) || "4000", 10);
  const dataDir = config.dataDir ?? getDefaultDataDir();
  const sqlitePath = config.sqlitePath ?? process.env.SQLITE_PATH ?? path.join(dataDir, "db", "boardmind.sqlite");
  const jwtSecret = config.jwtSecret ?? process.env.WS_JWT_SECRET ?? "boardmind-default-jwt-secret-key-32chars";

  const db = getDatabase(sqlitePath);
  const usageTracker = new UsageTracker(db);
  const snapshotStorage = new SnapshotStorage(db, dataDir);
  const router = config.router ?? new LLMRouter(db);
  const agentPipeline = new AgentPipeline(router, db);
  const roomManager = new RoomManager(snapshotStorage, agentPipeline, router);
  const voiceHandler = new VoiceHandler(usageTracker, snapshotStorage);

  const server = http.createServer(async (req, res) => {
    const parsed = parseUrl(req.url ?? "", true);
    const pathname = parsed.pathname ?? "";

    // Health check
    if (pathname === "/health" || pathname === "/internal/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          timestamp: Date.now(),
          providers: router.getStatus(),
        })
      );
      return;
    }

    // Internal evaluate IPC endpoint
    if (pathname === "/internal/evaluate" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const result = await agentPipeline.evaluate(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const parsed = parseUrl(req.url ?? "", true);
    const pathname = parsed.pathname ?? "";
    const token = (parsed.query.token as string) || "";

    // Authenticate token
    let authUser: WsTokenPayload | null = null;
    if (token) {
      authUser = verifyWsToken(token, jwtSecret);
    }

    // Match /ws/sync/:boardId
    const syncMatch = pathname.match(/^\/ws\/sync\/([^/?]+)/);
    if (syncMatch) {
      const boardId = syncMatch[1];
      const role = authUser && authUser.boardId === boardId ? authUser.role : (token ? "viewer" : "editor");
      const userId = authUser ? authUser.userId : `anon_${Math.random().toString(36).slice(2, 8)}`;

      console.log(`[SyncServer] Client connected to /ws/sync/${boardId}, userId=${userId}, role=${role}`);

      wss.handleUpgrade(req, socket, head, (ws) => {
        roomManager.handleConnection(ws, boardId, userId, role);
      });
      return;
    }

    // Match /ws/voice/:boardId
    const voiceMatch = pathname.match(/^\/ws\/voice\/([^/?]+)/);
    if (voiceMatch) {
      const boardId = voiceMatch[1];
      const userId = authUser ? authUser.userId : "guest_speaker";
      const userName = authUser ? `User_${authUser.userId.slice(0, 4)}` : "Guest Speaker";

      wss.handleUpgrade(req, socket, head, (ws) => {
        voiceHandler.handleConnection(ws, boardId, userId, userName, (bId) => {
          return roomManager.getRoom(bId).doc;
        });
      });
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });

  return {
    server,
    wss,
    db,
    router,
    agentPipeline,
    roomManager,
    snapshotStorage,
    voiceHandler,
    port,
    start: () => {
      return new Promise<void>((resolve) => {
        server.listen(port, () => {
          console.log(`[SyncServer] Listening on port ${port}`);
          resolve();
        });
      });
    },
    stop: () => {
      roomManager.stop();
      wss.close();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
