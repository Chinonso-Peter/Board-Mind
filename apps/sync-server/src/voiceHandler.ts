import fs from "fs";
import path from "path";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import {
  MultiProviderVoiceAdapter,
  UsageTracker,
  type TranscriptTurn,
} from "@boardmind/ai-core";
import { SnapshotStorage } from "./snapshotStorage.js";

interface VoiceClientContext {
  ws: WebSocket;
  userId: string;
  userName: string;
  boardId: string;
  mimeType: string;
  chunkSeq: number;
  sessionId: string;
}

export class VoiceHandler {
  private voiceAdapter: MultiProviderVoiceAdapter;

  constructor(
    private usageTracker: UsageTracker,
    private snapshotStorage: SnapshotStorage,
    voiceAdapter?: MultiProviderVoiceAdapter
  ) {
    this.voiceAdapter = voiceAdapter ?? new MultiProviderVoiceAdapter(usageTracker);
  }

  handleConnection(
    ws: WebSocket,
    boardId: string,
    userId: string,
    userName: string,
    getRoomDoc: (boardId: string) => Y.Doc
  ): void {
    const context: VoiceClientContext = {
      ws,
      userId,
      userName,
      boardId,
      mimeType: "audio/webm;codecs=opus",
      chunkSeq: 0,
      sessionId: uuidv4(),
    };

    ws.on("message", async (data: any, isBinary: boolean) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "VOICE_CONFIG") {
            if (msg.mimeType) context.mimeType = msg.mimeType;
          }
        } catch {
          // Ignore invalid JSON config
        }
        return;
      }

      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      // Validate chunk size: 1 KB <= bytes <= 2 MB
      if (buffer.length < 1024) {
        return; // Noise / silence / empty frame
      }
      if (buffer.length > 2 * 1024 * 1024) {
        ws.send(JSON.stringify({ type: "VOICE_ERROR", message: "Audio chunk exceeds 2MB limit" }));
        return;
      }

      context.chunkSeq++;

      // Save chunk to disk under /data/boards/{boardId}/transcripts/audio/
      try {
        const audioDir = this.snapshotStorage.getAudioDir(boardId);
        const ext = context.mimeType.includes("mp4") ? "mp4" : "webm";
        const filename = `${context.sessionId}_${context.chunkSeq}.${ext}`;
        fs.writeFileSync(path.join(audioDir, filename), buffer);
      } catch (err: any) {
        console.warn(`[VoiceHandler] Failed saving audio chunk: ${err.message}`);
      }

      // Transcribe via MultiProviderVoiceAdapter
      try {
        const result = await this.voiceAdapter.transcribe(buffer, context.mimeType);
        if (!result.text || result.text.length < 2) {
          return; // Ignore empty / silence
        }

        const turnId = uuidv4();
        const now = Date.now();
        const turn: TranscriptTurn = {
          id: turnId,
          speakerId: context.userId,
          speakerName: context.userName,
          text: result.text,
          timestamp: now,
          source: "voice",
          processedByAgent: false,
        };

        const doc = getRoomDoc(boardId);
        const transcriptArray = doc.getArray("transcript");
        const turnMap = new Y.Map();
        for (const [k, v] of Object.entries(turn)) {
          turnMap.set(k, v);
        }

        doc.transact(() => {
          transcriptArray.push([turnMap]);
        });

        ws.send(
          JSON.stringify({
            type: "TRANSCRIPT_ACK",
            turnId,
            provider: result.provider,
            latencyMs: result.durationMs,
          })
        );
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "VOICE_ERROR",
            message: err.message,
          })
        );
      }
    });

    ws.on("close", () => {
      // Stream ended
    });
  }
}
