# BoardMind — System Architecture Document

**Version:** 1.0.0  
**Status:** Implementation-Ready  
**Target Deployment:** Single-Node Self-Hosted (4 vCPU, 8 GB RAM, $0/month)  
**License Compliance:** 100% Open Source (MIT / Apache 2.0 / BSD / Public Domain)  

---

## 1. System Overview

### 1.1 Architectural Summary

**BoardMind** is an offline-tolerant, real-time collaborative system architecture whiteboard Progressive Web App (PWA) that passively listens to live engineering design-review discussions, detects concrete architectural decisions, and proposes incremental diagram mutations as non-destructive "ghost" overlays on an Excalidraw canvas. Built around a local-first Conflict-Free Replicated Data Type (CRDT) core using Yjs (`y-excalidraw` and `y-indexeddb`), BoardMind guarantees zero data loss during network partitions and supports 5 to 20 concurrent collaborators per board on a single self-hosted machine (4 vCPU, 8 GB RAM) at $0 monthly infrastructure cost. Live audio streams over authenticated WebSockets to a stateless Voice Service backed by free-tier cloud Whisper endpoints (Groq primary, Cloudflare Workers AI fallback), appending timestamped utterances into the shared Yjs document; an asynchronous AI Agent Service evaluates transcript deltas against a five-provider free-tier LLM failover chain (`Groq -> Cloudflare -> NVIDIA -> Z.AI -> Gemini`), passes structured intents through a deterministic Operation Planner and Spatial/Graph Validator, and broadcasts validated ghost overlays for human-in-the-loop approval or dismissal with full time-travel snapshot scrubbing.

### 1.2 System Architecture Diagram

```text
+---------------------------------------------------------------------------------------------------+
|                                   BROWSER CLIENT (Desktop / Tablet PWA)                           |
|                                                                                                   |
|  +-----------------------------+   +---------------------------+   +---------------------------+  |
|  |   Excalidraw Canvas UI      |   |   Ghost Overlay &         |   |   Audio Capture Engine    |  |
|  |   (React 19 + Next.js 15)   |   |   Timeline Scrubber UI    |   |   (getUserMedia + Opus)   |  |
|  +--------------+--------------+   +-------------+-------------+   +-------------+-------------+  |
|                 |                                |                               |                |
|                 v                                v                               |                |
|  +-------------------------------------------------------------+                 |                |
|  |              Zustand UI Store & Yjs CRDT Engine             |                 |                |
|  |  +-------------------+  +---------------+  +-------------+  |                 |                |
|  |  | y-excalidraw      |  | Y.Map /       |  | Awareness   |  |                 |                |
|  |  | Element Binding   |  | Y.Array State |  | (Cursors)   |  |                 |                |
|  |  +-------------------+  +---------------+  +-------------+  |                 |                |
|  +--------------+------------------------------+---------------+                 |                |
|                 |                              |                                 |                |
|                 v                              | (Offline Queue / Sync)          |                |
|  +-----------------------------+               |                                 |                |
|  |   y-indexeddb + Service     |               |                                 |                |
|  |   Worker (Offline Canvas)   |               |                                 |                |
|  +-----------------------------+               |                                 |                |
+------------------------------------------------|---------------------------------|----------------+
                                                 | WSS (/ws/sync/:boardId)         | WSS (/ws/voice/:boardId)
                                                 v                                 v
=====================================================================================================
                          SINGLE HOST MACHINE (4 vCPU, 8 GB RAM - Docker Compose)
=====================================================================================================
                                                 |                                 |
                                                 +----------------+----------------+
                                                                  |
                                                                  v
                                    +-------------------------------------------+
                                    |         Caddy Reverse Proxy (:443)        |
                                    |    Auto-TLS (HTTPS) + HTTP/2 + WS Upgrade |
                                    +----+---------------------------------+----+
                                         |                                 |
                    HTTPS (/api/*, /*)   |                                 | WS (/ws/sync/*, /ws/voice/*)
                                         v                                 v
+-------------------------------------------------+   +---------------------------------------------+
|           Frontend & Auth Server (:3000)        |   |         Realtime Sync Server (:4000)        |
|        (Next.js 15 + React 19 + NextAuth)       |   |       (Node.js + Yjs + y-websocket)         |
|                                                 |   |                                             |
|  - SSR / Static PWA Bundle & Service Worker     |   |  - Per-Board Room State & Awareness         |
|  - Local Credentials Auth (JWT/Cookie)          |   |  - 30s Debounced SQLite Snapshot Writer     |
|  - Board CRUD, Checkpoint Scrubbing & Exports   |   |  - Transcript Delta Watcher                 |
+------------------------+------------------------+   +------+-----------------------------+--------+
                         |                                   |                             |
                         |                                   | IPC / Internal HTTP         | Binary Audio Frames
                         |                                   v                             v
                         |            +-------------------------------+   +-------------------------+
                         |            |       AI Agent Service        |   |      Voice Service      |
                         |            |       (Node.js Worker)        |   |     (Node.js Worker)    |
                         |            |                               |   |                         |
                         |            |  1. Decision Detector (LLM)   |   |  1. Chunk Buffer (5s)   |
                         |            |  2. Intent Parser (LLM)       |   |  2. VoiceProviderAdapter|
                         |            |  3. Deterministic Planner     |   |  3. Transcript Appender |
                         |            |  4. Graph/Layout Validator    |   +------------+------------+
                         |            +---------------+---------------+                |
                         |                            |                                |
                         v                            v                                |
+-------------------------------------------------------------------------+            |
|                     Shared Local Storage (/data Volume)                 |            |
|  +----------------------------------+  +-----------------------------+  |            |
|  |   SQLite DB (WAL Mode)           |  |   Filesystem Artifact Store |  |            |
|  |   /data/db/boardmind.sqlite      |  |   /data/boards/{id}/        |  |            |
|  |   - users, boards, members       |  |     - snapshots/*.bin       |  |            |
|  |   - ai_proposals, checkpoints    |  |     - exports/*.{png,svg}   |  |            |
|  |   - provider_usage, sessions     |  |     - transcripts/*.{webm,  |  |            |
|  +----------------------------------+  |                    jsonl}   |  |            |
|                                        +-----------------------------+  |            |
+-------------------------------------------------------------------------+            |
                                                      |                                |
======================================================|================================|=============
                                 OUTBOUND HTTPS (OpenAI-Compatible SDK)                |
                                                      v                                v
+---------------------------------------------------------------------------------------------------+
|                                   FREE CLOUD AI & VOICE PROVIDERS                                 |
|                                                                                                   |
|  LLM Failover Chain:                                         Voice Failover Chain:                |
|  [1] Groq (gpt-oss-120b) ──(429/5xx)──>                      [1] Groq Whisper (whisper-large-v3)  |
|  [2] Cloudflare Workers AI (@cf/openai/gpt-oss-120b) ──>         ──(429/5xx)──>                   |
|  [3] NVIDIA NIM (nvidia/nemotron-3-ultra) ──>                [2] Cloudflare Workers AI Whisper    |
|  [4] Z.AI (glm-4.7-flash) ──>                                                                     |
|  [5] Google Gemini (gemini-3.5-flash-lite)                                                        |
+---------------------------------------------------------------------------------------------------+
```

### 1.3 Services and Processes

| Service / Process | Runtime & Port | Primary Responsibilities |
| :--- | :--- | :--- |
| **Caddy Reverse Proxy** | `caddy:2.8-alpine` (`:80`, `:443`) | Terminates TLS automatically (required for browser `getUserMedia`), enforces HTTPS redirects, serves security/PWA headers, and routes HTTP traffic to `:3000` and WebSocket upgrade traffic (`/ws/*`) to `:4000`. |
| **Frontend Server** | Node.js 22 LTS (`:3000`) | Long-lived Next.js 15 server hosting React 19 UI, Excalidraw canvas, NextAuth local credential authentication, REST endpoints for board management, timeline snapshot retrieval, and PWA assets (`manifest.json`, Service Worker). |
| **Sync Server** | Node.js 22 LTS (`:4000`) | Authoritative WebSocket hub (`y-websocket`) managing in-memory `Y.Doc` rooms per active board, multiplexing Awareness updates (cursors, active speakers, `"AI is thinking..."`), persisting binary Yjs snapshots to SQLite every 30 seconds, and dispatching transcript deltas to the AI Agent. |
| **AI Agent Service** | Node.js 22 LTS (Child Worker / Internal IPC `:4001`) | Consumes new transcript segments and serialized diagram graphs, executes the two-stage LLM pipeline via `LLMRouter` (5-provider failover), runs the deterministic Operation Planner and Validator, and writes validated ghost proposals back into the room's `Y.Doc`. |
| **Voice Service** | Node.js 22 LTS (Worker Module on `:4000/ws/voice`) | Receives binary WebSocket audio chunks (`audio/webm;codecs=opus` or `audio/mp4`), buffers 5-second voice-activity-gated segments, invokes `VoiceProviderAdapter` (Groq Whisper -> Cloudflare Whisper), archives raw audio/text to `/data`, and appends transcribed turns into `Y.Array('transcript')`. |
| **SQLite + Local File Store** | Embedded `better-sqlite3` + `/data` volume | ACID persistence in WAL mode for users, RBAC memberships, proposal audit logs, daily provider rate-limit counters, and binary Yjs snapshots alongside flat-file exports and audio archives. |

### 1.4 Browser Feature Dependencies

| Browser API | Purpose in BoardMind | Browser Support Matrix | Graceful Degradation / Offline Behavior |
| :--- | :--- | :--- | :--- |
| **WebSocket (`wss://`)** | Real-time Yjs CRDT delta sync, Awareness presence, and binary audio streaming. | Chrome/Edge 130+, Firefox 131+, Safari 16+ (Full support). | `y-websocket` enters exponential backoff reconnect (`1s` to `30s`); canvas edits continue uninterrupted locally and merge automatically on reconnect. |
| **IndexedDB** | Local CRDT state persistence via `y-indexeddb` for instant reloads and offline editing. | Chrome/Edge 130+, Firefox 131+, Safari 16+ (Full support). | If storage quota is exceeded or in private browsing mode with restricted quota, falls back to in-memory `Y.Doc` with a non-blocking warning banner. |
| **`navigator.mediaDevices.getUserMedia` & `MediaRecorder`** | Microphone capture for live design-review transcription. | Chrome/Edge 130+, Firefox 131+ (`audio/webm;codecs=opus`); Safari 16+ (`audio/mp4;codecs=mp4a.40.2`). | Requires secure context (`https://` via Caddy or `http://localhost`). If denied or offline, microphone button disables and users can type decisions directly into the transcript drawer. |
| **Service Worker & Cache API** | Offline PWA shell caching, static Excalidraw font/asset caching, and installability. | Chrome/Edge 130+, Firefox 131+, Safari 16+ (Full support). | Serves cached app shell and offline indicator badge when network is unreachable; blocks AI/voice actions with `"Offline — Canvas edits saved locally"`. |

---

## 2. Multi-Provider Free LLM Strategy

### 2.1 LLM Failover Provider Chain

All five providers expose OpenAI-compatible `/chat/completions` endpoints and are invoked via the official `openai` Node.js SDK (`^4.77.0`). Providers are evaluated strictly in priority order, failing over immediately on HTTP `429` (Rate Limit), HTTP `500`–`599` (Upstream Server Error), network timeout (`> 15,000 ms`), or malformed JSON after a single retry.

| Priority | Provider | Model Identifier | Max RPM | Max RPD | OpenAI-Compatible Base URL | Free Tier Quota Notes |
| :---: | :--- | :--- | :---: | :---: | :--- | :--- |
| **1** | **Groq** | `gpt-oss-120b` | 30 | 1,000 | `https://api.groq.com/openai/v1` | Primary low-latency inference; ~200,000 tokens/day cap. |
| **2** | **Cloudflare Workers AI** | `@cf/openai/gpt-oss-120b` | 300 | 10,000 | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` | 10,000 free neurons/day (~10,000 lightweight calls). |
| **3** | **NVIDIA NIM** | `nvidia/nemotron-3-ultra` | 40 | 10,000 | `https://integrate.api.nvidia.com/v1` | Free developer tier via `nvapi-*` bearer key. |
| **4** | **Z.AI** | `glm-4.7-flash` | 30 | 1,000 | `https://api.z.ai/api/paas/v4` | Free flash tier; conservative 1,000 RPD soft cap enforced locally. |
| **5** | **Google Gemini** | `gemini-3.5-flash-lite` | 15 | 500 | `https://generativelanguage.googleapis.com/v1beta/openai` | Google AI Studio free tier; final safety net. |

**Combined Daily Capacity:** $1,000 + 10,000 + 10,000 + 1,000 + 500 = 22,500$ free LLM requests/day.

### 2.2 Free Voice Transcription Strategy

Voice transcription uses a unified `VoiceProviderAdapter` interface that accepts raw audio bytes and returns plain text, failing over from Groq Whisper to Cloudflare Workers AI Whisper on `429`, `5xx`, or daily quota exhaustion.

| Priority | Provider | Model | Free Quota | Endpoint |
| :---: | :--- | :--- | :--- | :--- |
| **1 (Primary)** | **Groq Whisper** | `whisper-large-v3` | 2,000 audio requests/day (20 RPM, 7,200 audio sec/hr) | `https://api.groq.com/openai/v1/audio/transcriptions` |
| **2 (Fallback)** | **Cloudflare Workers AI** | `@cf/openai/whisper` | Shared 10,000 neurons/day pool | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/openai/whisper` |

#### Unified Voice Adapter Interface & Implementation

```typescript
// packages/ai-core/src/voiceAdapter.ts
import OpenAI, { toFile } from "openai";
import { UsageTracker } from "./usageTracker";
import { CircuitBreaker } from "./llmRouter";

export interface TranscriptResult {
  text: string;
  provider: "groq-whisper" | "cloudflare-whisper";
  durationMs: number;
  language: string;
}

export interface VoiceProviderAdapter {
  transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscriptResult>;
}

export class MultiProviderVoiceAdapter implements VoiceProviderAdapter {
  private groqClient: OpenAI;
  private groqBreaker = new CircuitBreaker("groq-whisper");
  private cfBreaker = new CircuitBreaker("cloudflare-whisper");

  constructor(private usageTracker: UsageTracker) {
    this.groqClient = new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY!,
      timeout: 15_000,
    });
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    language = "en"
  ): Promise<TranscriptResult> {
    const start = Date.now();
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";

    // 1. Primary: Groq Whisper (whisper-large-v3)
    if (
      this.groqBreaker.shouldAttempt() &&
      this.usageTracker.getDailyRequests("groq-whisper") < 2000
    ) {
      try {
        const file = await toFile(audioBuffer, `chunk.${ext}`, { type: mimeType });
        const response = await this.groqClient.audio.transcriptions.create({
          file,
          model: "whisper-large-v3",
          language,
          response_format: "json",
          temperature: 0.0,
        });

        this.groqBreaker.recordSuccess();
        this.usageTracker.increment("groq-whisper", 1, Math.ceil(audioBuffer.length / 1024));

        return {
          text: response.text.trim(),
          provider: "groq-whisper",
          durationMs: Date.now() - start,
          language,
        };
      } catch (err: any) {
        this.groqBreaker.recordFailure();
        if (err.status !== 429 && !(err.status >= 500 && err.status < 600)) {
          // Non-transient error still falls through to Cloudflare before failing
          console.warn(`[VoiceAdapter] Groq Whisper non-standard error: ${err.message}`);
        }
      }
    }

    // 2. Fallback: Cloudflare Workers AI Whisper
    if (
      this.cfBreaker.shouldAttempt() &&
      this.usageTracker.getDailyRequests("cloudflare-whisper") < 5000
    ) {
      try {
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
        const apiKey = process.env.CLOUDFLARE_API_KEY!;
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(audioBuffer),
          signal: AbortSignal.timeout(20_000),
        });

        if (!res.ok) {
          throw Object.assign(new Error(`CF Whisper HTTP ${res.status}`), { status: res.status });
        }

        const payload = (await res.json()) as { result?: { text?: string } };
        this.cfBreaker.recordSuccess();
        this.usageTracker.increment("cloudflare-whisper", 1, Math.ceil(audioBuffer.length / 1024));

        return {
          text: (payload.result?.text ?? "").trim(),
          provider: "cloudflare-whisper",
          durationMs: Date.now() - start,
          language,
        };
      } catch (err: any) {
        this.cfBreaker.recordFailure();
        throw new Error(`All voice transcription providers failed: ${err.message}`);
      }
    }

    throw new Error("Voice transcription daily limit reached across all providers.");
  }
}
```

### 2.3 Circuit Breaker State Machine

Each LLM and Voice provider maintains an isolated in-memory `CircuitBreaker` instance:

```text
                  +---------------------------------------+
                  |                CLOSED                 |
                  |  (Normal operation; failures = 0..2)  |
                  +---+-------------------------------+---+
                      |                               ^
    3 consecutive     |                               | Request succeeds
    failures          |                               | (failures = 0)
                      v                               |
                  +---+-------------------------------+---+
                  |                 OPEN                  |
                  |   (Fail-fast skip for 60,000 ms)      |
                  +-------------------+-------------------+
                                      |
                                      | 60,000 ms elapsed
                                      v
                  +-------------------+-------------------+
                  |               HALF_OPEN               |
                  |    (Permit 1 probe request through)   |
                  +-------------------+-------------------+
                                      |
                                      +---> Request fails ---> [OPEN] (reset 60s timer)
```

* **Failure Counting Rules:** HTTP `429`, HTTP `500`–`599`, network socket resets, and request timeouts increment `failures`. HTTP `401`/`403` (invalid API key) immediately trips the breaker to `OPEN` and logs an operator warning so valid providers are not slowed down.

### 2.4 Rate Limiting and Cost Control

1. **Per-Session Proposal & Token Budget:**
   * Each active design-review session is capped at **50 AI proposals** (or **40,000 combined tokens**) per 45-minute window, tracked in `Y.Map('meta').get('proposalsUsedInSession')` and backed by the `sessions` table.
   * When reached, the AI Agent pauses automatic decision detection and displays: `"Session AI budget reached (50/50 proposals). Start a new session to continue."`
2. **Global Daily Usage Tracker (SQLite-Persisted):**
   * Every successful API call updates `provider_usage` (`provider_name`, `date`, `requests_used`, `tokens_used`) inside a synchronous SQLite `WAL` transaction.
   * `date` is formatted as `YYYY-MM-DD` in **UTC**. At `00:00:00 UTC`, queries naturally roll over to the new date key with `requests_used = 0`.
   * On service restart, `LLMRouter` hydrates its in-memory `dailyUsage` map from SQLite for the current UTC date.
3. **Bounded Request Queue (Max Depth = 5):**
   * Incoming AI evaluation jobs enter a FIFO queue with `MAX_QUEUE_DEPTH = 5` and per-board concurrency = `1`.
   * If `queue.length >= 5`, new requests are rejected immediately without calling any external API, returning `{ error: "AI is busy, try again in 30s" }`.
4. **Total Exhaustion Handling:**
   * If every provider in `PROVIDERS` has `requestsToday >= maxRPD` or an `OPEN` circuit breaker, `LLMRouter` computes hours until `00:00:00 UTC`:
     $$H_{\text{reset}} = \left\lceil \frac{T_{\text{next\_midnight\_UTC}} - T_{\text{now}}}{3,600,000} \right\rceil$$
   * Broadcasts awareness status `"AI daily limit reached — resets in {X}h"` to all connected clients.

### 2.5 Token Budget Calculator

* **Stage 1 (Decision Detection) Average Payload:**
  * System prompt: $195$ tokens
  * User prompt (last 3 transcript turns + compact node list): $210$ tokens
  * JSON output (`is_decision`, `confidence`, `reason`): $45$ tokens
  * **Stage 1 Subtotal:** $450$ tokens (executed on every 15s/utterance transcript batch).
* **Stage 2 (Intent Parsing — runs only when `is_decision == true` and `confidence >= 0.75`):**
  * System prompt: $310$ tokens
  * User prompt (confirmed decision + full JSON graph of $\le 200$ nodes): $420$ tokens
  * JSON output (`EditIntent` array): $170$ tokens
  * **Stage 2 Subtotal:** $900$ tokens.
* **Amortized Proposal Cost:** Assuming 1 architectural decision per 3 transcript batches:
  $$\text{Tokens per Proposal} \approx (3 \times 450) + 900 = 2,250 \text{ total tokens} \quad (\approx 800 \text{ tokens per LLM call})$$
* **45-Minute Design Review Session:**
  $$50 \text{ proposals} \times 800 \text{ avg tokens/call} = 40,000 \text{ tokens/session}$$
* **Daily Provider Headroom:**
  * **Groq alone:** $\frac{200,000 \text{ TPD}}{800 \text{ tokens/call}} = 250 \text{ calls/day}$ (or up to $1,000$ RPD for short prompts).
  * **Cloudflare Workers AI:** $10,000 \text{ RPD} \approx 5,000+$ full two-stage proposals/day.
  * **NVIDIA NIM:** $10,000 \text{ RPD} \approx 5,000+$ full two-stage proposals/day.
  * **Total System Capacity:** $> 11,000$ complete AI diagram proposals per day — supporting over $220$ full 45-minute design review sessions daily at **$0.00/month**.

---

## 3. Data Model

### 3.1 Yjs Document Schema (`board:{boardId}`)

Each board maps 1:1 to a single `Y.Doc` synchronized across clients via `y-websocket` and persisted locally in the browser via `y-indexeddb`.

```typescript
// Shared Root Structures inside Y.Doc (room = `board:${boardId}`)
export interface BoardYDocSchema {
  // 1. Canonical Excalidraw Elements (bound via y-excalidraw)
  // Ordered array representing z-index layer order
  elements: Y.Array<Y.Map<ExcalidrawElementValue>>;

  // 2. Shared Canvas Metadata (theme, gridSize)
  appState: Y.Map<{
    viewBackgroundColor: string;
    gridSize: number | null;
  }>;

  // 3. Append-Only Live Design Review Transcript
  transcript: Y.Array<Y.Map<{
    id: string;                        // UUIDv7
    speakerId: string;                 // User ID from NextAuth session
    speakerName: string;               // Display name
    text: string;                      // Transcribed or typed utterance
    timestamp: number;                 // Unix epoch ms
    source: "voice" | "text";          // Input modality
    processedByAgent: boolean;         // True once evaluated by Decision Detector
  }>>;

  // 4. AI Diagram Mutation Proposals (Keyed by proposalId)
  proposals: Y.Map<Y.Map<{
    id: string;                        // UUIDv7
    status: "pending" | "approved" | "dismissed";
    decisionSummary: string;           // Human-readable reason from LLM
    confidence: number;                // 0.0 - 1.0
    providerUsed: string;              // e.g., "groq", "cloudflare"
    operationsJson: string;            // JSON-serialized EditIntent[]
    plannedMutationsJson: string;      // JSON-serialized PlannedMutation[]
    ghostElementsJson: string;         // JSON-serialized ExcalidrawElement[] for overlay
    createdAt: number;                 // Unix epoch ms
    resolvedBy: string | null;         // User ID who clicked Approve/Dismiss
    resolvedAt: number | null;         // Unix epoch ms
  }>>;

  // 5. Version Timeline Checkpoints (Metadata pointers to binary snapshots)
  checkpoints: Y.Array<Y.Map<{
    id: string;                        // UUIDv7
    label: string;                     // e.g., "Initial Diagram", "Approved: Add Redis Cache"
    trigger: "manual" | "ai_approved" | "session_start";
    proposalId: string | null;         // Linked AI proposal if trigger === "ai_approved"
    snapshotPath: string;              // Relative path under /data/boards/{boardId}/snapshots/
    elementCount: number;              // Number of canonical elements at checkpoint
    createdAt: number;                 // Unix epoch ms
    createdBy: string;                 // User ID
  }>>;

  // 6. Room & Session Control Counters
  meta: Y.Map<{
    boardId: string;
    schemaVersion: number;             // Currently 1
    activeSessionId: string | null;
    sessionStartedAt: number | null;
    proposalsUsedInSession: number;    // Enforces 50 proposals / 45-min cap
  }>;
}
```

### 3.2 SQLite Schema (Full SQL DDL)

SQLite runs in **WAL (Write-Ahead Logging)** mode (`PRAGMA journal_mode = WAL;`) with `PRAGMA synchronous = NORMAL;` and `PRAGMA foreign_keys = ON;` to support concurrent reads from the Frontend API and writes from the Sync Server and AI Agent with sub-millisecond latency.

```sql
-- /data/db/boardmind.sqlite initialization DDL
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 1. Users (Local NextAuth Credentials)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,                 -- UUIDv7
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,                  -- Argon2id / bcrypt hash
    created_at INTEGER NOT NULL                   -- Unix epoch ms
);

-- 2. Boards
CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY NOT NULL,                 -- UUIDv7
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Board Members (RBAC)
CREATE TABLE IF NOT EXISTS board_members (
    board_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    added_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, user_id),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Latest Yjs Binary State per Board (30s periodic & mutation flush)
CREATE TABLE IF NOT EXISTS board_snapshots (
    board_id TEXT PRIMARY KEY NOT NULL,
    yjs_state BLOB NOT NULL,                      -- Y.encodeStateAsUpdate(doc)
    state_vector BLOB NOT NULL,                   -- Y.encodeStateVector(doc)
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- 5. AI Proposals Audit & Analytics Log
CREATE TABLE IF NOT EXISTS ai_proposals (
    id TEXT PRIMARY KEY NOT NULL,                 -- UUIDv7
    board_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'dismissed', 'rejected_validation')),
    input_transcript TEXT NOT NULL,
    output_ops TEXT NOT NULL,                     -- JSON string of EditIntent[] + PlannedMutation[]
    provider_used TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- 6. Version Checkpoints (Timeline Scrubbing)
CREATE TABLE IF NOT EXISTS version_checkpoints (
    id TEXT PRIMARY KEY NOT NULL,                 -- UUIDv7
    board_id TEXT NOT NULL,
    label TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,                  -- e.g., /data/boards/{board_id}/snapshots/{id}.bin
    created_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- 7. Design Review Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,                 -- UUIDv7
    board_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    transcript_path TEXT NOT NULL,                -- e.g., /data/boards/{board_id}/transcripts/{id}.jsonl
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- 8. Daily Free-Tier Provider Usage Tracker (Resets at 00:00 UTC)
CREATE TABLE IF NOT EXISTS provider_usage (
    provider_name TEXT NOT NULL,                  -- 'groq' | 'cloudflare' | 'nvidia' | 'zai' | 'gemini' | 'groq-whisper' | 'cloudflare-whisper'
    date TEXT NOT NULL,                           -- 'YYYY-MM-DD' in UTC
    requests_used INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_name, date)
);

-- Indexes for fast timeline, proposal, and membership lookups
CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_board_created ON ai_proposals(board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_board_created ON version_checkpoints(board_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_sessions_board ON sessions(board_id, started_at DESC);
```

### 3.3 File-Based Storage Layout (`/data`)

No external object storage (S3/MinIO) is used. All binary artifacts reside on a Docker persistent volume mounted at `/data`:

```text
/data/
├── db/
│   ├── boardmind.sqlite                  # Primary SQLite database
│   ├── boardmind.sqlite-wal              # Write-Ahead Log
│   └── boardmind.sqlite-shm              # Shared memory index
└── boards/
    └── {board_id}/
        ├── snapshots/
        │   ├── {checkpoint_id}.bin       # Raw Y.encodeStateAsUpdate(ydoc) binary snapshot
        │   └── ...
        ├── exports/
        │   ├── {timestamp}_{slug}.png    # Server/client-generated PNG snapshot
        │   └── {timestamp}_{slug}.svg    # Vector SVG export
        └── transcripts/
            ├── {session_id}.jsonl        # Line-delimited JSON transcript log
            └── audio/
                └── {session_id}_{seq}.webm  # Raw 5s audio chunks (auto-pruned after 7 days)
```

### 3.4 Diagram Element Representation in Excalidraw

BoardMind maps architectural primitives onto standard Excalidraw elements enriched with `customData` so the AI pipeline can reconstruct a clean directed property graph at any moment without heuristics:

1. **Architecture Node (Service, Database, Queue, Cache, Gateway, External Actor):**
   * Represented as a shape element (`type: "rectangle" | "diamond" | "ellipse"`) paired with a bound child `type: "text"` element (`containerId = node.id`).
   * **Semantic Styling & Metadata:**
     ```json
     {
       "id": "node_redis_01",
       "type": "rectangle",
       "x": 420,
       "y": 180,
       "width": 180,
       "height": 80,
       "strokeColor": "#1e1e1e",
       "backgroundColor": "#fff3bf",
       "fillStyle": "solid",
       "strokeWidth": 2,
       "roundness": { "type": 3 },
       "boundElements": [
         { "id": "txt_redis_01", "type": "text" },
         { "id": "edge_api_redis", "type": "arrow" }
       ],
       "customData": {
         "bmKind": "node",
         "nodeType": "cache",
         "label": "Redis Cache",
         "aiGenerated": true,
         "proposalId": "01932a1b-..."
       }
     }
     ```
   * **Node Type Visual Palette:**
     * `service`: `rectangle`, `#a5d8ff` (soft blue)
     * `database`: `ellipse` / cylinder-styled `rectangle`, `#b2f2bb` (soft green)
     * `cache`: `rectangle`, `#fff3bf` (soft yellow)
     * `queue`: `rectangle` (wide `200x64`), `#ffd8a8` (soft orange)
     * `gateway`: `diamond`, `#d0bfff` (soft purple)
     * `external`: `rectangle` (`strokeStyle: "dashed"`), `#e9ecef` (neutral gray)

2. **Directed Edge (Data Flow, RPC, Event Stream):**
   * Represented as an `arrow` element with `startBinding` and `endBinding` pointing to source and target node IDs, plus an optional bound `text` element (`containerId = arrow.id`) for protocol/label annotations (e.g., `"gRPC"`, `"Async Events"`):
     ```json
     {
       "id": "edge_api_redis",
       "type": "arrow",
       "x": 340,
       "y": 220,
       "width": 80,
       "height": 0,
       "points": [[0, 0], [80, 0]],
       "startBinding": { "elementId": "node_api_01", "focus": 0, "gap": 4 },
       "endBinding": { "elementId": "node_redis_01", "focus": 0, "gap": 4 },
       "endArrowhead": "arrow",
       "boundElements": [{ "id": "txt_edge_01", "type": "text" }],
       "customData": {
         "bmKind": "edge",
         "sourceId": "node_api_01",
         "targetId": "node_redis_01",
         "label": "GET/SET"
       }
     }
     ```

3. **Label:**
   * Either a bound `text` element (`containerId: "<node_or_arrow_id>"`) or a standalone `text` annotation (`containerId: null`, `customData: { bmKind: "label" }`).

4. **Group (VPC, Kubernetes Cluster, Bounded Context):**
   * Shared UUID string in `groupIds: ["grp_vpc_prod"]` across member elements, optionally enclosed by a large background `rectangle` with `customData: { bmKind: "group_boundary", groupId: "grp_vpc_prod", label: "VPC" }`.

### 3.5 Mapping an AI Proposal to Excalidraw Element Operations

```text
[Confirmed Decision]
       │
       ▼
[Intent Parser LLM] ──> EditIntent[] (e.g., insert_between("api", "postgres", "Redis Cache"))
       │
       ▼
[Operation Planner] ──> PlannedMutation[] (add/update/delete canonical Excalidraw elements)
       │
       ▼
[Graph/Layout Validator] ──> Passes all 6 invariants
       │
       ▼
[Ghost Generator] ──> Clones added/updated elements with Ghost Styling:
       │               - strokeStyle: "dashed"
       │               - strokeColor: "#4f46e5" (Indigo-600)
       │               - backgroundColor: "#eef2ff"
       │               - opacity: 60
       │               - locked: true (non-selectable by Excalidraw pointer)
       │               - customData.isGhost = true, customData.proposalId = id
       │
       ▼
[Stored in Y.Map('proposals').set(id, proposalMap)]
       │
       ├──> CLIENT RENDER: Zustand selector merges canonical `elements` + active `ghostElements`
       │    into Excalidraw's `elements` prop and renders floating Approve / Dismiss pill over
       │    the ghost bounding box centroid.
       │
       ├──> ON USER APPROVE (Atomic Y.Doc Transaction):
       │      1. Apply `plannedMutations` directly to `Y.Array('elements')` (solid styling, opacity 100).
       │      2. Set `proposal.status = 'approved'`, `resolvedBy = userId`, `resolvedAt = now`.
       │      3. Trigger Sync Server checkpoint snapshot (`/data/boards/{id}/snapshots/{ckptId}.bin`).
       │
       └──> ON USER DISMISS (Atomic Y.Doc Transaction):
              1. Set `proposal.status = 'dismissed'`, `resolvedBy = userId`, `resolvedAt = now`.
              2. Ghost overlay disappears immediately across all connected clients.
```

---

## 4. Service Specifications

### 4.1 Frontend Server (`apps/web`)

* **Language, Framework & Key Libraries:**
  * TypeScript `5.7.2`, Node.js `22.11.0` LTS
  * `next` `15.1.0` (MIT), `react` `19.0.0` & `react-dom` `19.0.0` (MIT)
  * `@excalidraw/excalidraw` `0.18.0` (MIT)
  * `yjs` `13.6.20` (MIT), `y-websocket` `2.0.4` (MIT), `y-indexeddb` `9.0.12` (MIT), `y-excalidraw` `2.0.10` (MIT)
  * `zustand` `5.0.2` (MIT)
  * `next-auth` `5.0.0-beta.25` (MIT), `bcryptjs` `2.4.3` (MIT)
  * `better-sqlite3` `11.7.0` (MIT / SQLite Public Domain)
* **Entry Point & Request Lifecycle:**
  * Entry point: `next start -p 3000` (long-lived Node process inside container).
  * On page load (`/board/[boardId]`): NextAuth verifies session cookie -> validates `board_members` role -> renders board shell -> client hydrates `Y.Doc` immediately from `y-indexeddb` (zero-latency offline paint) -> opens `wss://{host}/ws/sync/{boardId}?token={wsJwt}` -> binds `ExcalidrawBinding` and Zustand UI state.
  * PWA Lifecycle: Service worker (`/sw.js`) caches static JS chunks, Excalidraw worker/font bundles, and `/offline` fallback route using a Stale-While-Revalidate strategy for assets and Network-First for `/api/*`.
* **REST API Endpoints:**

| Method | Path | Request Body / Params | Response Body (`200` / `201`) |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | `{ email: string, name: string, password: string }` | `{ user: { id, email, name } }` |
| `POST` | `/api/auth/[...nextauth]` | NextAuth credentials form (`email`, `password`) | HTTP `302` + `Set-Cookie: authjs.session-token` |
| `GET` | `/api/boards` | Session cookie | `{ boards: Array<{ id, name, role, updatedAt }> }` |
| `POST` | `/api/boards` | `{ name: string }` | `{ board: { id, name, ownerId, createdAt } }` |
| `GET` | `/api/boards/:id/ws-token` | Path param `id` + Session cookie | `{ token: string, expiresAt: number, role: string }` (Short-lived HMAC-SHA256 JWT for Sync Server auth) |
| `GET` | `/api/boards/:id/checkpoints` | Path param `id` | `{ checkpoints: Array<{ id, label, trigger, createdAt }> }` |
| `GET` | `/api/boards/:id/checkpoints/:ckptId/state` | Path params `id`, `ckptId` | Binary `application/octet-stream` (`Y.encodeStateAsUpdate` snapshot for read-only timeline preview) |
| `POST` | `/api/boards/:id/checkpoints/:ckptId/restore` | Path params `id`, `ckptId` | `{ restored: true, newCheckpointId: string }` (Overwrites live room `Y.Doc` with snapshot state) |
| `POST` | `/api/boards/:id/export` | `{ format: "png" \| "svg", dataBase64: string }` | `{ path: string, downloadUrl: string }` |
| `GET` | `/api/ai/status` | Session cookie | `{ providers: ProviderStatus[], sessionProposalsRemaining: number }` |

* **State Management:**
  * **CRDT State (`Y.Doc` + `y-indexeddb`):** Canonical elements, transcript, proposals, checkpoint metadata.
  * **Ephemeral UI State (`Zustand`):** Selected tool, active ghost proposal focus ID, timeline scrubber preview mode (`isScrubbing: boolean`, `previewElements: ExcalidrawElement[] | null`), microphone recording state (`isRecording`, `audioLevel`), and offline connectivity flag.
* **Scaling Strategy:**
  * Single instance handles 20+ concurrent users effortlessly (~350 MB RAM footprint). To scale horizontally, place multiple stateless Next.js containers behind Caddy with sticky cookies (`lb_policy cookie`) and move SQLite to a shared NVMe volume or LiteFS.
* **Failure Modes & Recovery:**
  * *Crash / OOM:* Docker `restart: unless-stopped` restarts `next-server` in `< 2s`; clients experience zero canvas interruption because `Y.Doc` lives in browser memory + IndexedDB and reconnects transparently.

### 4.2 Realtime Sync Server (`apps/sync-server`)

* **Language, Framework & Key Libraries:**
  * TypeScript `5.7.2`, Node.js `22.11.0` LTS
  * `ws` `8.18.0` (MIT), `yjs` `13.6.20` (MIT), `y-websocket` `2.0.4` (MIT), `lib0` `0.2.99` (MIT)
  * `better-sqlite3` `11.7.0` (MIT)
* **Entry Point & Main Loop:**
  * Entry point: `node dist/index.js` listening on internal port `4000`.
  * Handles HTTP `upgrade` requests on two paths:
    1. `/ws/sync/:boardId` -> Yjs CRDT sync & Awareness protocol.
    2. `/ws/voice/:boardId` -> Delegates binary audio frames to the Voice Service handler.
  * Runs a background **Persistence Loop** every `30,000 ms` (and debounced `3,000 ms` after any AI proposal approval) that flushes dirty `Y.Doc` rooms into SQLite `board_snapshots` (`BLOB`).
  * Runs a **Transcript Observer** attached to `ydoc.getArray('transcript')` that batches unprocessed utterances every `4,000 ms` (or on sentence-ending punctuation) and dispatches them to the AI Agent Service.
* **WebSocket Protocol & Message Handlers:**

| Channel / Message Type | Direction | Payload Structure | Handler Behavior |
| :--- | :--- | :--- | :--- |
| `WS Upgrade /ws/sync/:boardId?token=...` | Client -> Server | HTTP Upgrade + JWT | Verifies HMAC signature & board role (`viewer` connections reject `MSG_SYNC` update writes; allow `MSG_AWARENESS` only). |
| `y-websocket` `MSG_SYNC (0)` | Bidirectional | Binary `lib0` varUint (`SyncStep1`, `SyncStep2`, `Update`) | Merges CRDT updates into room `Y.Doc`, broadcasts diff to peers, marks room `dirty = true`. |
| `y-websocket` `MSG_AWARENESS (1)` | Bidirectional | Binary `lib0` Awareness (`cursor`, `user`, `aiStatus`, `speaking`) | Broadcasts live cursors and `"AI is thinking..."` banner state across room clients. |
| `CONTROL_PROPOSE_DECISION (0x10)` | Server -> Client | JSON `{ type: "PROPOSAL_CREATED", proposalId: string }` | Notifies clients to chime/highlight the newly added ghost overlay in `Y.Map('proposals')`. |
| `CONTROL_AI_ERROR (0x11)` | Server -> Client | JSON `{ type: "AI_NOTICE", level: "warn" \| "error", message: string }` | Displays non-intrusive toast (e.g., `"AI is busy, try again in 30s"` or `"AI daily limit reached — resets in 4h"`). |

* **State Management:**
  * Active `Y.Doc` rooms held in an in-memory `Map<string, RoomContext>` with a 15-minute idle eviction timer (flushes to SQLite `board_snapshots` before unloading from RAM).
* **Scaling Strategy:**
  * Single Node.js process easily sustains 20 concurrent users per board across 10+ active boards (< 400 MB RAM). Multi-instance scaling uses consistent hashing by `boardId` in Caddy (`lb_policy uri_hash` on `/ws/sync/*`) so all users on the same board land on the same `Y.Doc` room owner.
* **Failure Modes & Recovery:**
  * *Uncaught Exception / Process Restart:* On room load, Sync Server reads `board_snapshots.yjs_state` from SQLite; when reconnecting clients send their `SyncStep1` state vector, any offline edits made during the restart merge cleanly via CRDT union.

### 4.3 AI Agent Service (`apps/ai-agent`)

* **Language, Framework & Key Libraries:**
  * TypeScript `5.7.2`, Node.js `22.11.0` LTS (spawned as a dedicated `worker_threads` / child process by Sync Server)
  * `openai` `4.77.0` (Apache 2.0)
  * `zod` `3.24.1` (MIT)
  * `uuid` `11.0.3` (MIT)
* **Entry Point & Execution Lifecycle:**
  * Entry point: `dist/agentWorker.js` communicating over structured IPC / internal HTTP (`127.0.0.1:4001`).
  * Lifecycle per transcript batch:
    1. Check session proposal count (`< 50`) and FIFO queue depth (`< 5`).
    2. Broadcast Awareness `aiStatus = "analyzing"` to room.
    3. Execute **Stage 1 (Decision Detection)** via `LLMRouter`. If `is_decision === false` or `confidence < 0.75`, clear `aiStatus` and exit.
    4. Execute **Stage 2 (Intent Parsing)** via `LLMRouter` with full compact diagram graph.
    5. Execute **Deterministic Operation Planner** (`EditIntent[] -> PlannedMutation[]`).
    6. Execute **Deterministic Validator** (6 structural & spatial checks).
    7. Persist proposal to SQLite `ai_proposals`, generate ghost elements, and commit to `Y.Map('proposals')`.
* **Internal IPC / HTTP Interface:**

| Endpoint / Message | Request Payload | Response Payload |
| :--- | :--- | :--- |
| `POST /internal/evaluate` | `{ boardId: string, sessionId: string, transcriptDelta: TranscriptTurn[], diagramGraph: CompactGraph, rawElements: ExcalidrawElement[] }` | `{ status: "no_decision" \| "proposed" \| "rejected_validation" \| "rate_limited", proposalId?: string, reason?: string }` |
| `GET /internal/health` | None | `{ queueDepth: number, providers: ProviderStatus[] }` |

* **State Management:**
  * Stateless per request except for `LLMRouter` circuit breakers, in-memory FIFO queue (`maxDepth = 5`), and SQLite-backed `provider_usage` counters.
* **Failure Modes & Recovery:**
  * *Provider Rate Limit / Outage:* `LLMRouter` automatically fails over across all 5 providers in `< 500 ms` on HTTP `429`/`5xx`.
  * *Malformed LLM Output:* Retries once with corrective JSON instruction on the same provider, then advances to the next provider in the chain; if all fail, logs error and emits `CONTROL_AI_ERROR` without mutating the board.

### 4.4 Voice Service (`apps/voice-service`)

* **Language, Framework & Key Libraries:**
  * TypeScript `5.7.2`, Node.js `22.11.0` LTS (co-located worker module inside Sync Server process to avoid extra container overhead)
  * `openai` `4.77.0` (Apache 2.0)
* **Entry Point & Request Lifecycle:**
  * Entry point: WebSocket upgrade handler on `/ws/voice/:boardId?token={wsJwt}`.
  * Client captures microphone via `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 } })` and `MediaRecorder` emitting `5,000 ms` timeslice blobs (`audio/webm;codecs=opus` on Chrome/Firefox/Edge; `audio/mp4` on Safari 16+).
  * Voice Service validates chunk size (`1 KB <= bytes <= 2 MB`), appends raw chunk to `/data/boards/{boardId}/transcripts/audio/`, invokes `MultiProviderVoiceAdapter.transcribe()`, filters Whisper silence hallucinations (e.g., `"Thank you."`, `"[BLANK_AUDIO]"`), and pushes a new `Y.Map` entry into `ydoc.getArray('transcript')`.
* **WebSocket Message Handlers:**

| Frame Type | Direction | Payload | Action |
| :--- | :--- | :--- | :--- |
| Binary Frame (`0x02`) | Client -> Server | Raw audio blob (`webm` or `mp4` bytes, max 2 MB) | Transcribes via Groq Whisper -> Cloudflare Whisper and appends to `Y.Array('transcript')`. |
| Text Frame (`0x01`) | Client -> Server | `{ type: "VOICE_CONFIG", mimeType: string, language?: string }` | Sets codec metadata for the active speaker stream. |
| Text Frame (`0x01`) | Server -> Client | `{ type: "TRANSCRIPT_ACK", turnId: string, provider: string, latencyMs: number }` | Confirms chunk transcription or emits `{ type: "VOICE_ERROR", message: string }`. |

* **State Management:**
  * Per-connection stream context (`userId`, `userName`, `boardId`, `mimeType`, `chunkSeq`) held in memory for the duration of the WebSocket connection.
* **Failure Modes & Recovery:**
  * *Groq Whisper 429 / Timeout:* Automatically switches to Cloudflare Workers AI Whisper on the same audio buffer with zero lost speech.
  * *Network Drop:* Client `MediaRecorder` stops cleanly and surfaces `"Voice paused — offline"`; text input remains available.

---

## 5. AI Agent Pipeline

### 5.1 Prompt Template 1: Decision Detection

* **System Message (`192` tokens):**

```text
You are a senior software architecture observer listening to a live engineering design review.
Your sole task is to determine whether the latest conversation segment contains a concrete, actionable architectural decision that should change the system diagram.

Rules:
1. Return is_decision: true ONLY when participants agree on or explicitly decide to add, remove, connect, disconnect, rename, split, or insert a system component or data flow (e.g., "Let's put Redis in front of Postgres", "We should drop Kafka and use SQS", "Add an API Gateway").
2. Return is_decision: false for small talk, open-ended questions without resolution ("Should we use Redis or Memcached?"), explanations of existing boxes, or off-topic remarks.
3. Respond strictly with valid JSON matching this schema:
{"is_decision": boolean, "confidence": number, "reason": string}
```

* **User Message Format (`~180`–`260` tokens):**

```text
CURRENT DIAGRAM COMPONENTS:
{{compact_nodes_and_edges_summary}}

RECENT CONTEXT (ALREADY PROCESSED):
{{previous_2_turns}}

NEW TRANSCRIPT DELTA TO EVALUATE:
{{unprocessed_turns}}
```

* **Output Schema:**
  ```json
  {
    "is_decision": true,
    "confidence": 0.92,
    "reason": "Team agreed to introduce a Redis cache between the API Service and PostgreSQL database."
  }
  ```

### 5.2 Prompt Template 2: Intent Parsing

* **System Message (`318` tokens):**

```text
You are an architectural diagram compiler. Convert the confirmed engineering decision into an ordered list of atomic graph edit operations against the provided diagram JSON.

Allowed operations (use ONLY these 8 types):
1. {"op": "add_node", "label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external", "positionHint": "right_of"|"left_of"|"below"|"above"|"center", "anchorNodeId"?: string}
2. {"op": "remove_node", "id": string}
3. {"op": "add_edge", "sourceId": string, "targetId": string, "label"?: string}
4. {"op": "remove_edge", "id": string}
5. {"op": "relabel_element", "id": string, "newLabel": string}
6. {"op": "reposition_element", "id": string, "x": number, "y": number}
7. {"op": "insert_between", "sourceId": string, "targetId": string, "newNode": {"label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external"}}
8. {"op": "fork_path", "sourceId": string, "branchNode": {"label": string, "nodeType": "service"|"database"|"cache"|"queue"|"gateway"|"external"}, "targetId"?: string}

Constraints:
- Reference existing node and edge IDs accurately from CURRENT DIAGRAM GRAPH.
- Prefer "insert_between" when placing middleware/caches/queues along an existing connection.
- Output strictly valid JSON: {"operations": EditIntent[]}
```

* **User Message Format (`~300`–`550` tokens):**

```text
CONFIRMED DECISION:
"{{decision_reason}}"

SUPPORTING TRANSCRIPT:
{{unprocessed_turns}}

CURRENT DIAGRAM GRAPH (JSON):
{{full_compact_graph_json}}
```

* **Strict `EditIntent` Output JSON Schema (enforced via `response_format: { type: "json_object" }` + Zod):**
  ```json
  {
    "operations": [
      {
        "op": "insert_between",
        "sourceId": "node_api_01",
        "targetId": "node_pg_01",
        "newNode": {
          "label": "Redis Cache",
          "nodeType": "cache"
        }
      }
    ]
  }
  ```

### 5.3 Deterministic Operation Planner (Full Pseudocode)

The Operation Planner contains **zero LLM calls**. It translates `EditIntent[]` into deterministic Excalidraw element mutations (`add`, `update`, `delete`) using a virtual working copy of the diagram state so chained operations in a single batch compose cleanly.

```typescript
// packages/ai-core/src/operationPlanner.ts

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const GRID_GAP_X = 260;
const GRID_GAP_Y = 150;
const SNAP_GRID = 20;

function snap(val: number): number {
  return Math.round(val / SNAP_GRID) * SNAP_GRID;
}

function getNodeColors(nodeType: NodeType): { bg: string; strokeStyle: "solid" | "dashed" } {
  const palette: Record<NodeType, { bg: string; strokeStyle: "solid" | "dashed" }> = {
    service:  { bg: "#a5d8ff", strokeStyle: "solid" },
    database: { bg: "#b2f2bb", strokeStyle: "solid" },
    cache:    { bg: "#fff3bf", strokeStyle: "solid" },
    queue:    { bg: "#ffd8a8", strokeStyle: "solid" },
    gateway:  { bg: "#d0bfff", strokeStyle: "solid" },
    external: { bg: "#e9ecef", strokeStyle: "dashed" },
  };
  return palette[nodeType] ?? palette.service;
}

function findFreeSlot(
  desiredX: number,
  desiredY: number,
  width: number,
  height: number,
  existingNodes: Map<string, DiagramNode>
): { x: number; y: number } {
  let x = snap(desiredX);
  let y = snap(desiredY);
  const padding = 24;

  // Spiral / downward step search until no bounding box overlap exists
  for (let attempt = 0; attempt < 25; attempt++) {
    let collides = false;
    for (const node of existingNodes.values()) {
      const overlapX = x < node.x + node.width + padding && x + width + padding > node.x;
      const overlapY = y < node.y + node.height + padding && y + height + padding > node.y;
      if (overlapX && overlapY) {
        collides = true;
        break;
      }
    }
    if (!collides) return { x, y };
    y = snap(y + GRID_GAP_Y);
  }
  return { x, y };
}

function computeEdgeGeometry(source: DiagramNode, target: DiagramNode) {
  const sCx = source.x + source.width / 2;
  const sCy = source.y + source.height / 2;
  const tCx = target.x + target.width / 2;
  const tCy = target.y + target.height / 2;
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  let startX = sCx;
  let startY = sCy;
  let endX = tCx;
  let endY = tCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal dominant connection
    startX = dx >= 0 ? source.x + source.width : source.x;
    endX = dx >= 0 ? target.x : target.x + target.width;
  } else {
    // Vertical dominant connection
    startY = dy >= 0 ? source.y + source.height : source.y;
    endY = dy >= 0 ? target.y : target.y + target.height;
  }

  return {
    x: snap(startX),
    y: snap(startY),
    points: [
      [0, 0],
      [snap(endX - startX), snap(endY - startY)],
    ] as [number, number][],
  };
}

export function planOperations(
  intents: EditIntent[],
  initialElements: ExcalidrawElement[]
): PlannedMutation[] {
  const state = buildWorkingGraph(initialElements); // Clones nodes, edges, and bound text maps
  const mutations: PlannedMutation[] = [];

  // Helper 1: add_node(label, type, position_hint, anchorNodeId?)
  function execAddNode(
    label: string,
    nodeType: NodeType,
    positionHint: PositionHint,
    anchorNodeId?: string,
    explicitCoords?: { x: number; y: number }
  ): DiagramNode {
    const nodeId = `node_${uuidv7()}`;
    const textId = `txt_${uuidv7()}`;
    const width = Math.max(NODE_WIDTH, snap(label.length * 10 + 40));
    const height = NODE_HEIGHT;

    let rawX = 200;
    let rawY = 200;

    if (explicitCoords) {
      rawX = explicitCoords.x;
      rawY = explicitCoords.y;
    } else if (anchorNodeId && state.nodes.has(anchorNodeId)) {
      const anchor = state.nodes.get(anchorNodeId)!;
      switch (positionHint) {
        case "right_of": rawX = anchor.x + anchor.width + GRID_GAP_X; rawY = anchor.y; break;
        case "left_of":  rawX = anchor.x - width - GRID_GAP_X;        rawY = anchor.y; break;
        case "below":    rawX = anchor.x;                              rawY = anchor.y + anchor.height + GRID_GAP_Y; break;
        case "above":    rawX = anchor.x;                              rawY = anchor.y - height - GRID_GAP_Y; break;
        default:         rawX = anchor.x + GRID_GAP_X;                 rawY = anchor.y + GRID_GAP_Y; break;
      }
    } else if (state.nodes.size > 0) {
      // Place to the right of the rightmost node
      let maxRight = -Infinity;
      let refY = 200;
      for (const n of state.nodes.values()) {
        if (n.x + n.width > maxRight) {
          maxRight = n.x + n.width;
          refY = n.y;
        }
      }
      rawX = maxRight + 100;
      rawY = refY;
    }

    const { x, y } = findFreeSlot(rawX, rawY, width, height, state.nodes);
    const style = getNodeColors(nodeType);

    const shapeEl = createExcalidrawShape({
      id: nodeId,
      type: nodeType === "gateway" ? "diamond" : "rectangle",
      x,
      y,
      width,
      height,
      backgroundColor: style.bg,
      strokeStyle: style.strokeStyle,
      boundElements: [{ id: textId, type: "text" }],
      customData: { bmKind: "node", nodeType, label, aiGenerated: true },
    });

    const textEl = createExcalidrawBoundText({
      id: textId,
      containerId: nodeId,
      text: label,
      x: x + 10,
      y: y + height / 2 - 12,
      width: width - 20,
      height: 24,
    });

    const nodeRecord: DiagramNode = { id: nodeId, textId, label, nodeType, x, y, width, height };
    state.nodes.set(nodeId, nodeRecord);

    mutations.push({ op: "add", elementId: nodeId, element: shapeEl });
    mutations.push({ op: "add", elementId: textId, element: textEl });
    return nodeRecord;
  }

  // Helper 2: remove_node(id)
  function execRemoveNode(id: string): void {
    const node = state.nodes.get(id);
    if (!node) return;

    // Cascade delete any edges attached to this node
    for (const [edgeId, edge] of Array.from(state.edges.entries())) {
      if (edge.sourceId === id || edge.targetId === id) {
        execRemoveEdge(edgeId);
      }
    }

    if (node.textId) {
      mutations.push({ op: "delete", elementId: node.textId });
    }
    mutations.push({ op: "delete", elementId: id });
    state.nodes.delete(id);
  }

  // Helper 3: add_edge(source_id, target_id, label?)
  function execAddEdge(sourceId: string, targetId: string, label?: string): DiagramEdge | null {
    const source = state.nodes.get(sourceId);
    const target = state.nodes.get(targetId);
    if (!source || !target) return null;

    const edgeId = `edge_${uuidv7()}`;
    const labelId = label ? `txt_${uuidv7()}` : undefined;
    const geom = computeEdgeGeometry(source, target);

    const arrowEl = createExcalidrawArrow({
      id: edgeId,
      x: geom.x,
      y: geom.y,
      points: geom.points,
      startBinding: { elementId: sourceId, focus: 0, gap: 4 },
      endBinding: { elementId: targetId, focus: 0, gap: 4 },
      boundElements: labelId ? [{ id: labelId, type: "text" }] : [],
      customData: { bmKind: "edge", sourceId, targetId, label: label ?? "" },
    });

    mutations.push({ op: "add", elementId: edgeId, element: arrowEl });
    mutations.push({
      op: "update",
      elementId: sourceId,
      patch: { appendBoundElement: { id: edgeId, type: "arrow" } },
    });
    mutations.push({
      op: "update",
      elementId: targetId,
      patch: { appendBoundElement: { id: edgeId, type: "arrow" } },
    });

    if (label && labelId) {
      const midX = geom.x + geom.points[1][0] / 2 - 40;
      const midY = geom.y + geom.points[1][1] / 2 - 12;
      const edgeTextEl = createExcalidrawBoundText({
        id: labelId,
        containerId: edgeId,
        text: label,
        x: snap(midX),
        y: snap(midY),
        width: 80,
        height: 20,
      });
      mutations.push({ op: "add", elementId: labelId, element: edgeTextEl });
    }

    const edgeRecord: DiagramEdge = { id: edgeId, labelId, sourceId, targetId, label };
    state.edges.set(edgeId, edgeRecord);
    return edgeRecord;
  }

  // Helper 4: remove_edge(id)
  function execRemoveEdge(id: string): void {
    const edge = state.edges.get(id);
    if (!edge) return;
    if (edge.labelId) {
      mutations.push({ op: "delete", elementId: edge.labelId });
    }
    mutations.push({ op: "delete", elementId: id });
    state.edges.delete(id);
  }

  // Helper 5: relabel_element(id, new_label)
  function execRelabelElement(id: string, newLabel: string): void {
    if (state.nodes.has(id)) {
      const node = state.nodes.get(id)!;
      const newWidth = Math.max(NODE_WIDTH, snap(newLabel.length * 10 + 40));
      node.label = newLabel;
      node.width = newWidth;
      mutations.push({
        op: "update",
        elementId: id,
        patch: {
          width: newWidth,
          customData: { bmKind: "node", nodeType: node.nodeType, label: newLabel },
        },
      });
      if (node.textId) {
        mutations.push({
          op: "update",
          elementId: node.textId,
          patch: { text: newLabel, originalText: newLabel, width: newWidth - 20 },
        });
      }
    } else if (state.edges.has(id)) {
      const edge = state.edges.get(id)!;
      edge.label = newLabel;
      if (edge.labelId) {
        mutations.push({
          op: "update",
          elementId: edge.labelId,
          patch: { text: newLabel, originalText: newLabel },
        });
      }
    }
  }

  // Helper 6: reposition_element(id, x, y)
  function execRepositionElement(id: string, targetX: number, targetY: number): void {
    const node = state.nodes.get(id);
    if (!node) return;
    const { x, y } = findFreeSlot(targetX, targetY, node.width, node.height, state.nodes);
    const dx = x - node.x;
    const dy = y - node.y;
    node.x = x;
    node.y = y;

    mutations.push({ op: "update", elementId: id, patch: { x, y } });
    if (node.textId) {
      mutations.push({ op: "update", elementId: node.textId, patch: { deltaX: dx, deltaY: dy } });
    }

    // Recompute geometry for all incident edges
    for (const edge of state.edges.values()) {
      if (edge.sourceId === id || edge.targetId === id) {
        const src = state.nodes.get(edge.sourceId)!;
        const dst = state.nodes.get(edge.targetId)!;
        const geom = computeEdgeGeometry(src, dst);
        mutations.push({
          op: "update",
          elementId: edge.id,
          patch: { x: geom.x, y: geom.y, points: geom.points },
        });
      }
    }
  }

  // Helper 7: insert_between(source_id, target_id, new_node)
  function execInsertBetween(
    sourceId: string,
    targetId: string,
    newNodeSpec: { label: string; nodeType: NodeType }
  ): void {
    const source = state.nodes.get(sourceId);
    const target = state.nodes.get(targetId);
    if (!source || !target) return;

    // Locate existing direct edge(s) from source -> target and preserve label
    let preservedLabel: string | undefined;
    for (const [edgeId, edge] of Array.from(state.edges.entries())) {
      if (edge.sourceId === sourceId && edge.targetId === targetId) {
        preservedLabel = edge.label;
        execRemoveEdge(edgeId);
      }
    }

    // Place new node at midpoint; if tight, shift target downstream
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    if (Math.abs(target.x - source.x) < GRID_GAP_X * 1.5) {
      execRepositionElement(targetId, target.x + GRID_GAP_X, target.y);
    }

    const created = execAddNode(
      newNodeSpec.label,
      newNodeSpec.nodeType,
      "right_of",
      sourceId,
      { x: midX, y: midY }
    );
    execAddEdge(sourceId, created.id, preservedLabel);
    execAddEdge(created.id, targetId);
  }

  // Helper 8: fork_path(source_id, branch_node, target_id?)
  function execForkPath(
    sourceId: string,
    branchNodeSpec: { label: string; nodeType: NodeType },
    targetId?: string
  ): void {
    const source = state.nodes.get(sourceId);
    if (!source) return;

    // Offset parallel branch below the source node
    const created = execAddNode(
      branchNodeSpec.label,
      branchNodeSpec.nodeType,
      "below",
      sourceId,
      { x: source.x + Math.round(GRID_GAP_X * 0.6), y: source.y + GRID_GAP_Y }
    );

    execAddEdge(sourceId, created.id, "async / branch");
    if (targetId && state.nodes.has(targetId)) {
      execAddEdge(created.id, targetId);
    }
  }

  // Dispatch all intents in order
  for (const intent of intents) {
    switch (intent.op) {
      case "add_node":
        execAddNode(intent.label, intent.nodeType, intent.positionHint, intent.anchorNodeId);
        break;
      case "remove_node":
        execRemoveNode(intent.id);
        break;
      case "add_edge":
        execAddEdge(intent.sourceId, intent.targetId, intent.label);
        break;
      case "remove_edge":
        execRemoveEdge(intent.id);
        break;
      case "relabel_element":
        execRelabelElement(intent.id, intent.newLabel);
        break;
      case "reposition_element":
        execRepositionElement(intent.id, intent.x, intent.y);
        break;
      case "insert_between":
        execInsertBetween(intent.sourceId, intent.targetId, intent.newNode);
        break;
      case "fork_path":
        execForkPath(intent.sourceId, intent.branchNode, intent.targetId);
        break;
    }
  }

  return mutations;
}
```

### 5.4 Deterministic Validator (Full Pseudocode)

Before any proposal is exposed to users as a ghost overlay, the deterministic Validator simulates applying `PlannedMutation[]` to the current board elements and enforces six structural and geometric invariants.

```typescript
// packages/ai-core/src/proposalValidator.ts

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_BOARD_ELEMENTS = 200;
const MIN_BOX_SEPARATION = 12; // pixels

export function validateProposal(
  currentElements: ExcalidrawElement[],
  mutations: PlannedMutation[],
  options: { allowOrphanNodes?: boolean } = {}
): ValidationResult {
  const errors: string[] = [];

  if (mutations.length === 0) {
    return { valid: false, errors: ["Proposal produced zero element mutations."] };
  }

  // Apply mutations to a dry-run element map
  const simulated = simulateMutations(currentElements, mutations);

  // Check 1: Max element count per board (<= 200)
  if (simulated.allElements.length > MAX_BOARD_ELEMENTS) {
    errors.push(
      `Element cap exceeded: ${simulated.allElements.length} > ${MAX_BOARD_ELEMENTS} max elements.`
    );
  }

  const nodeMap = new Map<string, DiagramNode>();
  const edgeList: DiagramEdge[] = [];

  for (const el of simulated.allElements) {
    if (el.isDeleted) continue;
    if (el.customData?.bmKind === "node") {
      nodeMap.set(el.id, {
        id: el.id,
        label: el.customData.label ?? "",
        nodeType: el.customData.nodeType ?? "service",
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      });
    } else if (el.customData?.bmKind === "edge" || el.type === "arrow") {
      const sourceId = el.startBinding?.elementId ?? el.customData?.sourceId;
      const targetId = el.endBinding?.elementId ?? el.customData?.targetId;
      edgeList.push({
        id: el.id,
        sourceId,
        targetId,
        label: (el.customData?.label ?? "").trim().toLowerCase(),
      });
    }
  }

  // Check 2 & 3: Edge referential integrity & No self-referencing edges
  const degreeMap = new Map<string, number>();
  for (const nodeId of nodeMap.keys()) {
    degreeMap.set(nodeId, 0);
  }

  const edgeSignatureSet = new Set<string>();

  for (const edge of edgeList) {
    if (!edge.sourceId || !nodeMap.has(edge.sourceId)) {
      errors.push(`Edge ${edge.id} references non-existent sourceId '${edge.sourceId}'.`);
      continue;
    }
    if (!edge.targetId || !nodeMap.has(edge.targetId)) {
      errors.push(`Edge ${edge.id} references non-existent targetId '${edge.targetId}'.`);
      continue;
    }

    // Check 3: No self-referencing edges
    if (edge.sourceId === edge.targetId) {
      errors.push(`Edge ${edge.id} is self-referencing on node '${edge.sourceId}'.`);
    }

    // Check 4: No duplicate edges (same sourceId, targetId, and normalized label)
    const sig = `${edge.sourceId}->${edge.targetId}::${edge.label}`;
    if (edgeSignatureSet.has(sig)) {
      errors.push(`Duplicate edge detected: ${sig}`);
    }
    edgeSignatureSet.add(sig);

    degreeMap.set(edge.sourceId, (degreeMap.get(edge.sourceId) ?? 0) + 1);
    degreeMap.set(edge.targetId, (degreeMap.get(edge.targetId) ?? 0) + 1);
  }

  // Check 5: No orphan nodes (unless explicitly allowed or board has <= 1 node)
  if (!options.allowOrphanNodes && nodeMap.size > 1) {
    for (const [nodeId, degree] of degreeMap.entries()) {
      if (degree === 0) {
        const label = nodeMap.get(nodeId)?.label ?? nodeId;
        errors.push(`Orphan node detected without edges: '${label}' (${nodeId}).`);
      }
    }
  }

  // Check 6: Layout bounding-box overlap check across all nodes
  const nodes = Array.from(nodeMap.values());
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlapX =
        a.x < b.x + b.width + MIN_BOX_SEPARATION &&
        a.x + a.width + MIN_BOX_SEPARATION > b.x;
      const overlapY =
        a.y < b.y + b.height + MIN_BOX_SEPARATION &&
        a.y + a.height + MIN_BOX_SEPARATION > b.y;

      if (overlapX && overlapY) {
        errors.push(
          `Bounding box overlap between '${a.label}' (${a.id}) and '${b.label}' (${b.id}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

* **On Validation Failure:**
  1. Proposal is **not** written to `Y.Map('proposals')` (no broken ghost elements ever appear on the canvas).
  2. Logged to SQLite `ai_proposals` with `status = 'rejected_validation'` and `output_ops = JSON.stringify({ errors, mutations })`.
  3. Sync Server sends `CONTROL_AI_ERROR` (`level: "warn"`) to the room: `"AI skipped an invalid diagram edit: {errors[0]}"`.

### 5.5 LLM Response Parsing and Error Handling

Free-tier models occasionally wrap JSON in Markdown fences (` ```json ... ``` `) or emit trailing commentary. Every LLM response passes through a three-step extraction and validation pipeline:

```typescript
// packages/ai-core/src/responseParser.ts
import { z } from "zod";

export const DecisionDetectionSchema = z.object({
  is_decision: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

const NodeTypeEnum = z.enum(["service", "database", "cache", "queue", "gateway", "external"]);
const PositionHintEnum = z.enum(["right_of", "left_of", "below", "above", "center"]);

export const EditIntentSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    label: z.string().min(1).max(80),
    nodeType: NodeTypeEnum,
    positionHint: PositionHintEnum.default("right_of"),
    anchorNodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal("remove_node"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("add_edge"),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    label: z.string().max(60).optional(),
  }),
  z.object({
    op: z.literal("remove_edge"),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal("relabel_element"),
    id: z.string().min(1),
    newLabel: z.string().min(1).max(80),
  }),
  z.object({
    op: z.literal("reposition_element"),
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal("insert_between"),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    newNode: z.object({
      label: z.string().min(1).max(80),
      nodeType: NodeTypeEnum,
    }),
  }),
  z.object({
    op: z.literal("fork_path"),
    sourceId: z.string().min(1),
    branchNode: z.object({
      label: z.string().min(1).max(80),
      nodeType: NodeTypeEnum,
    }),
    targetId: z.string().optional(),
  }),
]);

export const IntentParserResponseSchema = z.object({
  operations: z.array(EditIntentSchema).min(1).max(10),
});

export function extractAndValidateJson<T>(rawText: string, schema: z.ZodType<T>): T {
  let candidate = rawText.trim();

  // Attempt 1: Direct JSON.parse
  try {
    return schema.parse(JSON.parse(candidate));
  } catch {
    // Fall through to fence stripping
  }

  // Attempt 2: Strip ```json ... ``` markdown fences
  const fencedMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    try {
      return schema.parse(JSON.parse(fencedMatch[1].trim()));
    } catch {
      // Fall through to outermost brace extraction
    }
  }

  // Attempt 3: Extract outermost {...} object
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sliced = candidate.slice(firstBrace, lastBrace + 1);
    return schema.parse(JSON.parse(sliced)); // Throws SyntaxError or ZodError if invalid
  }

  throw new Error("No valid JSON object found in LLM output.");
}
```

* **Malformed Output Retry Policy:**
  1. If `extractAndValidateJson` throws `SyntaxError` or `ZodError`, `AgentPipeline` retries **once** against the **same provider** by appending a corrective user turn: `"Your previous response failed JSON schema validation (${err.message}). Return ONLY valid JSON matching the schema."`
  2. If the retry also fails schema validation, `AgentPipeline` marks a soft failure and re-invokes `LLMRouter` starting from the **next provider** in the chain.
  3. If all providers fail, the pipeline logs the failure and notifies the room via `CONTROL_AI_ERROR` (`"AI could not parse a valid diagram update from that exchange."`).

### 5.6 Complete `LLMRouter` and `CircuitBreaker` Implementation

```typescript
// packages/ai-core/src/llmRouter.ts
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import Database from "better-sqlite3";

export interface LLMProvider {
  name: string;
  model: string;
  maxRPM: number;
  maxRPD: number;
  baseURL: string;
  client: OpenAI;
}

export interface LLMRequest {
  messages: ChatCompletionMessageParam[];
  preferredStartIndex?: number;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  tokens: number;
  providerIndex: number;
}

const PROVIDERS: LLMProvider[] = [
  {
    name: "groq",
    model: "gpt-oss-120b",
    maxRPM: 30,
    maxRPD: 1000,
    baseURL: "https://api.groq.com/openai/v1",
    client: new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || "missing",
      timeout: 15_000,
      maxRetries: 0, // Managed explicitly by LLMRouter
    }),
  },
  {
    name: "cloudflare",
    model: "@cf/openai/gpt-oss-120b",
    maxRPM: 300,
    maxRPD: 10000,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
    client: new OpenAI({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
      apiKey: process.env.CLOUDFLARE_API_KEY || "missing",
      timeout: 15_000,
      maxRetries: 0,
    }),
  },
  {
    name: "nvidia",
    model: "nvidia/nemotron-3-ultra",
    maxRPM: 40,
    maxRPD: 10000,
    baseURL: "https://integrate.api.nvidia.com/v1",
    client: new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY || "missing",
      timeout: 20_000,
      maxRetries: 0,
    }),
  },
  {
    name: "zai",
    model: "glm-4.7-flash",
    maxRPM: 30,
    maxRPD: 1000,
    baseURL: "https://api.z.ai/api/paas/v4",
    client: new OpenAI({
      baseURL: "https://api.z.ai/api/paas/v4",
      apiKey: process.env.ZAI_API_KEY || "missing",
      timeout: 15_000,
      maxRetries: 0,
    }),
  },
  {
    name: "gemini",
    model: "gemini-3.5-flash-lite",
    maxRPM: 15,
    maxRPD: 500,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    client: new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY || "missing",
      timeout: 15_000,
      maxRetries: 0,
    }),
  },
];

export class CircuitBreaker {
  state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 3;
  private readonly resetTimeout = 60_000;

  constructor(public name: string) {}

  recordSuccess(): void {
    this.state = "CLOSED";
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  tripImmediately(): void {
    this.failures = this.failureThreshold;
    this.lastFailureTime = Date.now();
    this.state = "OPEN";
  }

  shouldAttempt(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return true;
  }
}

export class LLMRouter {
  private providers: LLMProvider[];
  private circuitBreakers: Map<string, CircuitBreaker>;
  private dailyUsage: Map<string, number>;
  private rpmWindows: Map<string, number[]>;
  private currentUtcDate: string;
  private db: Database.Database;

  // Bounded FIFO Queue (Max 5 pending requests)
  private activeCount = 0;
  private readonly maxConcurrency = 2;
  private readonly maxQueueDepth = 5;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(sqlitePath = "/data/db/boardmind.sqlite") {
    this.providers = PROVIDERS;
    this.circuitBreakers = new Map(PROVIDERS.map((p) => [p.name, new CircuitBreaker(p.name)]));
    this.dailyUsage = new Map(PROVIDERS.map((p) => [p.name, 0]));
    this.rpmWindows = new Map(PROVIDERS.map((p) => [p.name, []]));
    this.currentUtcDate = this.getTodayUtc();
    this.db = new Database(sqlitePath);
    this.loadDailyUsageFromDB();
  }

  private getTodayUtc(): string {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  private getHoursUntilMidnightUtc(): number {
    const now = new Date();
    const nextMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    );
    return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 3_600_000));
  }

  private ensureCurrentUtcDay(): void {
    const today = this.getTodayUtc();
    if (today !== this.currentUtcDate) {
      this.currentUtcDate = today;
      for (const p of this.providers) {
        this.dailyUsage.set(p.name, 0);
      }
    }
  }

  private loadDailyUsageFromDB(): void {
    this.ensureCurrentUtcDay();
    const stmt = this.db.prepare(
      `SELECT provider_name, requests_used FROM provider_usage WHERE date = ?`
    );
    const rows = stmt.all(this.currentUtcDate) as Array<{
      provider_name: string;
      requests_used: number;
    }>;
    for (const row of rows) {
      this.dailyUsage.set(row.provider_name, row.requests_used);
    }
  }

  private incrementUsage(providerName: string, tokens: number): void {
    this.ensureCurrentUtcDay();
    const updatedRequests = (this.dailyUsage.get(providerName) ?? 0) + 1;
    this.dailyUsage.set(providerName, updatedRequests);

    const upsert = this.db.prepare(`
      INSERT INTO provider_usage (provider_name, date, requests_used, tokens_used)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(provider_name, date) DO UPDATE SET
        requests_used = requests_used + 1,
        tokens_used = tokens_used + excluded.tokens_used
    `);
    upsert.run(providerName, this.currentUtcDate, tokens);
  }

  private isWithinRpm(provider: LLMProvider): boolean {
    const now = Date.now();
    const timestamps = (this.rpmWindows.get(provider.name) ?? []).filter((ts) => now - ts < 60_000);
    this.rpmWindows.set(provider.name, timestamps);
    return timestamps.length < provider.maxRPM;
  }

  private recordRpmHit(providerName: string): void {
    const timestamps = this.rpmWindows.get(providerName) ?? [];
    timestamps.push(Date.now());
    this.rpmWindows.set(providerName, timestamps);
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }
    if (this.waitQueue.length >= this.maxQueueDepth) {
      throw new Error("AI is busy, try again in 30s");
    }
    return new Promise<void>((resolve, reject) => {
      this.waitQueue.push({
        resolve: () => {
          this.activeCount++;
          resolve();
        },
        reject,
      });
    });
  }

  private releaseSlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waitQueue.shift();
    if (next) next.resolve();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    await this.acquireSlot();
    try {
      this.ensureCurrentUtcDay();
      const startIndex = request.preferredStartIndex ?? 0;
      let exhaustedCount = 0;

      for (let i = startIndex; i < this.providers.length; i++) {
        const provider = this.providers[i];
        const cb = this.circuitBreakers.get(provider.name)!;

        if ((this.dailyUsage.get(provider.name) ?? 0) >= provider.maxRPD) {
          exhaustedCount++;
          continue;
        }
        if (!cb.shouldAttempt()) continue;
        if (!this.isWithinRpm(provider)) continue;

        try {
          this.recordRpmHit(provider.name);
          const response = await provider.client.chat.completions.create({
            model: provider.model,
            messages: request.messages,
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 2048,
          });

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw Object.assign(new Error("Empty completion content"), { status: 502 });
          }

          cb.recordSuccess();
          const tokens = response.usage?.total_tokens ?? 0;
          this.incrementUsage(provider.name, tokens);

          return {
            content,
            provider: provider.name,
            model: provider.model,
            tokens,
            providerIndex: i,
          };
        } catch (err: any) {
          if (err.status === 401 || err.status === 403) {
            cb.tripImmediately(); // Misconfigured key -> skip provider for 60s and continue chain
            continue;
          }
          if (err.status === 400) {
            throw new Error(`${provider.name}: ${err.message}`); // Bad request payload
          }
          cb.recordFailure();
          if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
            continue; // Rate limited or upstream 5xx -> failover to next provider
          }
          continue; // Timeout or transient network error -> failover to next provider
        }
      }

      if (exhaustedCount >= this.providers.length) {
        const hours = this.getHoursUntilMidnightUtc();
        throw new Error(`AI daily limit reached — resets in ${hours}h`);
      }

      throw new Error("All AI providers unavailable. Try again in 60s.");
    } finally {
      this.releaseSlot();
    }
  }

  getStatus() {
    this.ensureCurrentUtcDay();
    return this.providers.map((p) => ({
      name: p.name,
      model: p.model,
      circuit: this.circuitBreakers.get(p.name)!.state,
      requestsToday: this.dailyUsage.get(p.name) ?? 0,
      maxRPD: p.maxRPD,
    }));
  }
}
```

---

## 6. Deployment & Self-Hosting Configuration (Single-Node)

### 6.1 `docker-compose.yml` (4 vCPU, 8 GB RAM Target)

```yaml
services:
  caddy:
    image: caddy:2.8-alpine
    container_name: boardmind-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      - DOMAIN=${DOMAIN:-localhost}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - sync
    deploy:
      resources:
        limits:
          cpus: "0.50"
          memory: 256M

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: boardmind-web
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - SQLITE_PATH=/data/db/boardmind.sqlite
      - DATA_DIR=/data
      - NEXTAUTH_URL=https://${DOMAIN:-localhost}
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - WS_JWT_SECRET=${WS_JWT_SECRET}
    volumes:
      - boardmind_data:/data
    deploy:
      resources:
        limits:
          cpus: "1.50"
          memory: 3072M

  sync:
    build:
      context: .
      dockerfile: apps/sync-server/Dockerfile
    container_name: boardmind-sync
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=4000
      - SQLITE_PATH=/data/db/boardmind.sqlite
      - DATA_DIR=/data
      - WS_JWT_SECRET=${WS_JWT_SECRET}
      - GROQ_API_KEY=${GROQ_API_KEY}
      - CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID}
      - CLOUDFLARE_API_KEY=${CLOUDFLARE_API_KEY}
      - NVIDIA_API_KEY=${NVIDIA_API_KEY}
      - ZAI_API_KEY=${ZAI_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - boardmind_data:/data
    deploy:
      resources:
        limits:
          cpus: "2.00"
          memory: 4096M

volumes:
  boardmind_data:
  caddy_data:
  caddy_config:
```

### 6.2 `Caddyfile` (Auto-TLS & WebSocket Routing)

```caddyfile
{$DOMAIN:localhost} {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "microphone=(self)"
    }

    # Realtime Yjs Sync & Binary Voice Audio WebSockets
    @websockets {
        path /ws/*
    }
    reverse_proxy @websockets sync:4000

    # Next.js 15 Frontend, PWA Service Worker & REST APIs
    reverse_proxy web:3000
}
```