import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import Database from "better-sqlite3";
import { CircuitBreaker } from "./circuitBreaker.js";

export interface LLMProvider {
  name: string;
  model: string;
  maxRPM: number;
  maxRPD: number;
  baseURL: string;
  client: OpenAI | null;
}

export interface LLMRequest {
  messages: ChatCompletionMessageParam[];
  preferredStartIndex?: number;
  jsonMode?: boolean;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  tokens: number;
  providerIndex: number;
}

export function createDefaultProviders(): LLMProvider[] {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const cfKey = process.env.CLOUDFLARE_API_KEY;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const nvKey = process.env.NVIDIA_API_KEY;
  const zaiKey = process.env.ZAI_API_KEY;

  return [
    {
      name: "groq",
      model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
      maxRPM: 30,
      maxRPD: 1000,
      baseURL: "https://api.groq.com/openai/v1",
      client: groqKey && groqKey !== "missing"
        ? new OpenAI({
            baseURL: "https://api.groq.com/openai/v1",
            apiKey: groqKey,
            timeout: 15_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "groq-secondary",
      model: "openai/gpt-oss-120b",
      maxRPM: 30,
      maxRPD: 1000,
      baseURL: "https://api.groq.com/openai/v1",
      client: groqKey && groqKey !== "missing"
        ? new OpenAI({
            baseURL: "https://api.groq.com/openai/v1",
            apiKey: groqKey,
            timeout: 15_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "openai",
      model: "gpt-4o-mini",
      maxRPM: 60,
      maxRPD: 2000,
      baseURL: "https://api.openai.com/v1",
      client: openaiKey && openaiKey !== "missing"
        ? new OpenAI({
            baseURL: "https://api.openai.com/v1",
            apiKey: openaiKey,
            timeout: 5_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "gemini",
      model: "gemini-1.5-flash",
      maxRPM: 15,
      maxRPD: 1500,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      client: geminiKey && geminiKey !== "missing" && geminiKey.startsWith("AIzaSy")
        ? new OpenAI({
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey: geminiKey,
            timeout: 5_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "deepseek",
      model: "deepseek-chat",
      maxRPM: 60,
      maxRPD: 2000,
      baseURL: "https://api.deepseek.com",
      client: deepseekKey && deepseekKey !== "missing"
        ? new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey: deepseekKey,
            timeout: 15_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "cloudflare",
      model: "@cf/meta/llama-3.1-70b-instruct",
      maxRPM: 300,
      maxRPD: 10000,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccount || "acct"}/ai/v1`,
      client: cfKey && cfKey !== "missing" && cfAccount
        ? new OpenAI({
            baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1`,
            apiKey: cfKey,
            timeout: 15_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "nvidia",
      model: "nvidia/nemotron-3-ultra",
      maxRPM: 40,
      maxRPD: 10000,
      baseURL: "https://integrate.api.nvidia.com/v1",
      client: nvKey && nvKey !== "missing"
        ? new OpenAI({
            baseURL: "https://integrate.api.nvidia.com/v1",
            apiKey: nvKey,
            timeout: 20_000,
            maxRetries: 0,
          })
        : null,
    },
    {
      name: "zai",
      model: "glm-4.7-flash",
      maxRPM: 30,
      maxRPD: 1000,
      baseURL: "https://api.z.ai/api/paas/v4",
      client: zaiKey && zaiKey !== "missing"
        ? new OpenAI({
            baseURL: "https://api.z.ai/api/paas/v4",
            apiKey: zaiKey,
            timeout: 15_000,
            maxRetries: 0,
          })
        : null,
    },
  ];
}

export class LLMRouter {
  private providers: LLMProvider[];
  private circuitBreakers: Map<string, CircuitBreaker>;
  private dailyUsage: Map<string, number>;
  private rpmWindows: Map<string, number[]>;
  private currentUtcDate: string;
  private db: Database.Database | null = null;

  // Bounded FIFO Queue (Max 5 pending requests)
  private activeCount = 0;
  private readonly maxConcurrency = 2;
  private readonly maxQueueDepth = 5;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  // Optional mock runner for testing or keyless fallback
  public mockCompletion?: (messages: ChatCompletionMessageParam[]) => Promise<string>;

  constructor(sqliteOrDb?: Database.Database | string, customProviders?: LLMProvider[]) {
    this.providers = customProviders ?? createDefaultProviders();
    this.circuitBreakers = new Map(this.providers.map((p) => [p.name, new CircuitBreaker(p.name)]));
    this.dailyUsage = new Map(this.providers.map((p) => [p.name, 0]));
    this.rpmWindows = new Map(this.providers.map((p) => [p.name, []]));
    this.currentUtcDate = this.getTodayUtc();

    if (sqliteOrDb) {
      if (typeof sqliteOrDb === "string") {
        try {
          this.db = new Database(sqliteOrDb);
        } catch {
          // Fall back gracefully
        }
      } else {
        this.db = sqliteOrDb;
      }
    }
    this.loadDailyUsageFromDB();
  }

  public getTodayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  public getHoursUntilMidnightUtc(): number {
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
    if (!this.db || typeof this.db.prepare !== "function") return;
    this.ensureCurrentUtcDay();
    try {
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
    } catch {
      // Ignore if table not yet populated
    }
  }

  private incrementUsage(providerName: string, tokens: number): void {
    this.ensureCurrentUtcDay();
    const updatedRequests = (this.dailyUsage.get(providerName) ?? 0) + 1;
    this.dailyUsage.set(providerName, updatedRequests);

    if (this.db && typeof this.db.prepare === "function") {
      try {
        const upsert = this.db.prepare(`
          INSERT INTO provider_usage (provider_name, date, requests_used, tokens_used)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(provider_name, date) DO UPDATE SET
            requests_used = requests_used + 1,
            tokens_used = tokens_used + excluded.tokens_used
        `);
        upsert.run(providerName, this.currentUtcDate, tokens);
      } catch (err: any) {
        console.warn(`[LLMRouter] DB increment failed: ${err.message}`);
      }
    }
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

      // If mock completion is defined (tests / fallback), use it
      if (this.mockCompletion) {
        const content = await this.mockCompletion(request.messages);
        return {
          content,
          provider: "mock",
          model: "mock-model",
          tokens: 250,
          providerIndex: 0,
        };
      }

      const startIndex = request.preferredStartIndex ?? 0;
      let exhaustedCount = 0;
      let configuredCount = 0;

      for (let i = startIndex; i < this.providers.length; i++) {
        const provider = this.providers[i];
        if (!provider.client) {
          continue; // Key not set
        }
        configuredCount++;

        const cb = this.circuitBreakers.get(provider.name)!;

        if ((this.dailyUsage.get(provider.name) ?? 0) >= provider.maxRPD) {
          exhaustedCount++;
          continue;
        }
        if (!cb.shouldAttempt()) continue;
        if (!this.isWithinRpm(provider)) continue;

        try {
          this.recordRpmHit(provider.name);
          const isJson =
            request.jsonMode === true ||
            (request.jsonMode !== false &&
              request.messages.some(
                (m) => typeof m.content === "string" && m.content.toLowerCase().includes("json")
              ));

          let messages = request.messages;
          if (isJson && provider.name === "groq") {
            const hasJsonWord = messages.some(
              (m) => typeof m.content === "string" && m.content.toLowerCase().includes("json")
            );
            if (!hasJsonWord && messages.length > 0) {
              const first = messages[0];
              messages = [
                { ...first, content: `${first.content} (Respond in JSON)` } as any,
                ...messages.slice(1),
              ];
            }
          }

          const response = await provider.client.chat.completions.create({
            model: provider.model,
            messages,
            ...(isJson ? { response_format: { type: "json_object" } } : {}),
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
            cb.tripImmediately();
            continue;
          }
          if (err.status === 400) {
            throw new Error(`${provider.name}: ${err.message}`);
          }
          cb.recordFailure();
          if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
            continue;
          }
          continue;
        }
      }

      if (configuredCount > 0 && exhaustedCount >= configuredCount) {
        const hours = this.getHoursUntilMidnightUtc();
        throw new Error(`AI daily limit reached — resets in ${hours}h`);
      }

      // If no cloud keys are configured at all, synthesize deterministic architectural response
      return this.synthesizeLocalResponse(request.messages);
    } finally {
      this.releaseSlot();
    }
  }

  // Built-in offline deterministic fallback when no external LLM keys are supplied
  private synthesizeLocalResponse(messages: ChatCompletionMessageParam[]): LLMResponse {
    const systemMsg = messages.find((m) => m.role === "system")?.content?.toString() || "";
    const userMsg = messages.find((m) => m.role === "user")?.content?.toString() || "";
    const lower = userMsg.toLowerCase();

    // Stage 1: Decision detection
    if (
      systemMsg.includes("is_decision") ||
      systemMsg.includes("Senior Principal Systems Architect") ||
      systemMsg.includes("sole task")
    ) {
      const decisionPhrases = [
        "add", "put", "insert", "create", "use", "introduce", "connect",
        "replace", "remove", "delete", "cache", "redis", "kafka", "queue",
        "auth", "database", "postgres", "mongodb", "elasticsearch", "gateway",
        "worker", "service", "microservice", "broker", "storage", "s3",
        "rabbitmq", "dynamodb", "sqs", "notification", "inventory", "payment",
        "cdn", "cloudflare", "design", "draw", "architecture", "arcitecture",
        "modify", "update", "alright", "diagram", "let's", "we should"
      ];
      const isDecision = decisionPhrases.some((phrase) => lower.includes(phrase));

      let decisionTopic = "Architectural component modification";
      if (lower.includes("calculator")) decisionTopic = "Compile Calculator Microservice Architecture";
      else if (lower.includes("uber") || lower.includes("ride")) decisionTopic = "Compile Ride Hailing Architecture";
      else if (lower.includes("draw") || lower.includes("diagram") || lower.includes("update") || lower.includes("modify")) decisionTopic = "Compile Architecture Diagram on Whiteboard";
      else if (lower.includes("redis") || lower.includes("cache")) decisionTopic = "Add Redis Cache to accelerate data access and cache sessions";
      else if (lower.includes("kafka") || lower.includes("queue") || lower.includes("rabbitmq") || lower.includes("sqs")) decisionTopic = "Add Event Message Queue to decouple asynchronous workflows";
      else if (lower.includes("auth")) decisionTopic = "Add Auth Microservice for centralized authentication & JWT tokens";
      else if (lower.includes("elasticsearch") || lower.includes("search")) decisionTopic = "Add Elasticsearch cluster for low-latency full-text catalog search";
      else if (lower.includes("mongodb") || lower.includes("dynamo")) decisionTopic = "Add NoSQL document database for high-throughput flexible schema data";
      else if (lower.includes("postgres") || lower.includes("database") || lower.includes("sql")) decisionTopic = "Add PostgreSQL database cluster with read replicas for persistent transactions";
      else if (lower.includes("s3") || lower.includes("storage") || lower.includes("blob")) decisionTopic = "Add Object Storage (S3) for persistent media and asset hosting";
      else if (lower.includes("gateway") || lower.includes("ingress")) decisionTopic = "Add API Gateway for TLS termination, routing, and rate-limiting";
      else if (lower.includes("notification") || lower.includes("email")) decisionTopic = "Add Notification Worker to asynchronously dispatch emails and push notifications";
      else if (lower.includes("payment") || lower.includes("stripe")) decisionTopic = "Connect External Payment Gateway (Stripe) for secure idempotent transaction processing";
      else if (lower.includes("cdn") || lower.includes("cloudflare")) decisionTopic = "Add Edge CDN (Cloudflare) for global caching and DDoS mitigation";
      else if (lower.includes("remove") || lower.includes("delete")) decisionTopic = "Remove specified architectural component from the diagram";
      else if (lower.includes("worker") || lower.includes("batch")) decisionTopic = "Add Background Worker for batch processing tasks";

      const result = {
        is_decision: isDecision,
        confidence: isDecision ? 0.95 : 0.2,
        reason: isDecision ? decisionTopic : "No architectural decision detected.",
      };
      return {
        content: JSON.stringify(result),
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 150,
        providerIndex: 0,
      };
    }

    // Stage 2: Intent parsing (Graph edit operations)
    if (systemMsg.includes("architectural diagram compiler") || systemMsg.includes("Stage 2")) {
      const operations: any[] = [];

      let graph: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
      try {
        const jsonMatch = userMsg.match(/CURRENT DIAGRAM GRAPH \(JSON\):\s*([\s\S]*)/);
        if (jsonMatch && jsonMatch[1]) {
          graph = JSON.parse(jsonMatch[1].trim());
        }
      } catch {
        // Ignore JSON parse error
      }

      const deltaMatch = userMsg.match(/LATEST TRANSCRIPT DELTA:\s*([\s\S]*?)(?:CURRENT DIAGRAM GRAPH|$)/i);
      const instruction = (deltaMatch && deltaMatch[1] ? deltaMatch[1] : userMsg).toLowerCase();

      // 1. DELETE / REMOVE PRIORITY: Check if user asks to remove any component
      if (instruction.includes("remove") || instruction.includes("delete") || instruction.includes("drop")) {
        const words = instruction.split(/\s+/);
        for (const n of graph.nodes || []) {
          const l = (n.label || "").toLowerCase();
          const matches =
            (instruction.includes("cache") && (l.includes("cache") || l.includes("redis"))) ||
            (instruction.includes("redis") && l.includes("redis")) ||
            (instruction.includes("kafka") && (l.includes("kafka") || l.includes("queue"))) ||
            (instruction.includes("queue") && l.includes("queue")) ||
            (instruction.includes("postgres") && (l.includes("postgres") || l.includes("database") || l.includes("db"))) ||
            (instruction.includes("database") && (l.includes("database") || l.includes("postgres") || l.includes("db"))) ||
            (instruction.includes("gateway") && l.includes("gateway")) ||
            (instruction.includes("stripe") && (l.includes("stripe") || l.includes("payment"))) ||
            (instruction.includes("payment") && (l.includes("stripe") || l.includes("payment"))) ||
            (instruction.includes("web") && l.includes("web")) ||
            (instruction.includes("mobile") && l.includes("mobile")) ||
            (instruction.includes("client") && l.includes("client")) ||
            (instruction.includes("auth") && l.includes("auth")) ||
            (instruction.includes("history") && l.includes("history")) ||
            words.some((w) => w.length > 3 && l.includes(w));

          if (matches) {
            operations.push({ op: "remove_node", id: n.id });
          }
        }
        if (operations.length > 0) {
          return {
            content: JSON.stringify({ operations }),
            provider: "local-synthesizer",
            model: "rule-engine",
            tokens: 150,
            providerIndex: 0,
          };
        }
      }

      // 2. INSERT_BETWEEN: Check if user asks to place middleware or cache in between
      if ((instruction.includes("between") || instruction.includes("in front of")) && graph.nodes?.length >= 2) {
        const sourceNode = graph.nodes.find((n: any) => n.id.includes("checkout") || n.id.includes("service") || n.id.includes("gateway") || n.nodeType === "service");
        const targetNode = graph.nodes.find((n: any) => n.id.includes("postgres") || n.id.includes("db") || n.nodeType === "database");
        if (sourceNode && targetNode && sourceNode.id !== targetNode.id) {
          const isRedis = instruction.includes("redis") || instruction.includes("cache");
          operations.push({
            op: "insert_between",
            sourceId: sourceNode.id,
            targetId: targetNode.id,
            newNode: {
              label: isRedis ? "Redis Cache" : "Message Queue",
              nodeType: isRedis ? "cache" : "queue",
            },
          });
          return {
            content: JSON.stringify({ operations }),
            provider: "local-synthesizer",
            model: "rule-engine",
            tokens: 180,
            providerIndex: 0,
          };
        }
      }

      // 3. FULL SYSTEM ARCHITECTURES (e.g. Miro-style multi-tier left-to-right designs)
      if (
        instruction.includes("calculator") ||
        lower.includes("calculator")
      ) {
        operations.push(
          { op: "add_node", label: "Web App", nodeType: "external", positionHint: "center" },
          { op: "add_node", label: "Mobile App", nodeType: "external", positionHint: "below" },
          { op: "add_node", label: "Public API Consumers", nodeType: "external", positionHint: "below" },
          { op: "add_node", label: "API Gateway (Auth & Rate Limit)", nodeType: "gateway", positionHint: "right_of" },
          { op: "add_node", label: "Tokenizer & AST Parser", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Expression Validator", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Evaluator Engine", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Redis Result Cache", nodeType: "cache", positionHint: "above" },
          { op: "add_node", label: "History Service", nodeType: "service", positionHint: "below" },
          { op: "add_node", label: "PostgreSQL (Users & History)", nodeType: "database", positionHint: "right_of" },
          { op: "add_node", label: "Observability (Logs & Alerts)", nodeType: "service", positionHint: "below" },
          { op: "add_edge", sourceId: "Web App", targetId: "API Gateway (Auth & Rate Limit)", label: "HTTPS / REST" },
          { op: "add_edge", sourceId: "Mobile App", targetId: "API Gateway (Auth & Rate Limit)", label: "HTTPS / REST" },
          { op: "add_edge", sourceId: "Public API Consumers", targetId: "API Gateway (Auth & Rate Limit)", label: "API Key" },
          { op: "add_edge", sourceId: "API Gateway (Auth & Rate Limit)", targetId: "Tokenizer & AST Parser", label: "JSON POST" },
          { op: "add_edge", sourceId: "Tokenizer & AST Parser", targetId: "Expression Validator", label: "AST" },
          { op: "add_edge", sourceId: "Expression Validator", targetId: "Evaluator Engine", label: "Valid AST" },
          { op: "add_edge", sourceId: "Evaluator Engine", targetId: "Redis Result Cache", label: "Cache Lookup" },
          { op: "add_edge", sourceId: "Evaluator Engine", targetId: "History Service", label: "Async Event" },
          { op: "add_edge", sourceId: "History Service", targetId: "PostgreSQL (Users & History)", label: "SQL Insert" },
          { op: "add_edge", sourceId: "API Gateway (Auth & Rate Limit)", targetId: "Observability (Logs & Alerts)", label: "Metrics / Trace" }
        );
      } else if (
        instruction.includes("uber") ||
        instruction.includes("ride") ||
        instruction.includes("delivery") ||
        instruction.includes("doordash") ||
        lower.includes("uber") ||
        lower.includes("ride")
      ) {
        operations.push(
          { op: "add_node", label: "Rider Mobile App", nodeType: "external", positionHint: "center" },
          { op: "add_node", label: "Driver Mobile App", nodeType: "external", positionHint: "below" },
          { op: "add_node", label: "API Gateway (Envoy)", nodeType: "gateway", positionHint: "right_of" },
          { op: "add_node", label: "Matching & Dispatch Engine", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Location Cache (Redis Geo)", nodeType: "cache", positionHint: "above" },
          { op: "add_node", label: "Kafka Event Broker", nodeType: "queue", positionHint: "right_of" },
          { op: "add_node", label: "Trip & Ledger Service", nodeType: "service", positionHint: "below" },
          { op: "add_node", label: "PostgreSQL (Trips & Users)", nodeType: "database", positionHint: "right_of" },
          { op: "add_node", label: "Stripe Payment Gateway", nodeType: "external", positionHint: "below" },
          { op: "add_edge", sourceId: "Rider Mobile App", targetId: "API Gateway (Envoy)", label: "HTTPS / REST" },
          { op: "add_edge", sourceId: "Driver Mobile App", targetId: "API Gateway (Envoy)", label: "WebSocket / Geo" },
          { op: "add_edge", sourceId: "API Gateway (Envoy)", targetId: "Matching & Dispatch Engine", label: "gRPC" },
          { op: "add_edge", sourceId: "Matching & Dispatch Engine", targetId: "Location Cache (Redis Geo)", label: "GeoRadius" },
          { op: "add_edge", sourceId: "Matching & Dispatch Engine", targetId: "Kafka Event Broker", label: "TripRequested" },
          { op: "add_edge", sourceId: "Kafka Event Broker", targetId: "Trip & Ledger Service", label: "Consume Trip" },
          { op: "add_edge", sourceId: "Trip & Ledger Service", targetId: "PostgreSQL (Trips & Users)", label: "Persist SQL" },
          { op: "add_edge", sourceId: "Trip & Ledger Service", targetId: "Stripe Payment Gateway", label: "Charge API" }
        );
      } else if (
        instruction.includes("ledger") ||
        instruction.includes("financial") ||
        instruction.includes("transaction") ||
        instruction.includes("banking") ||
        lower.includes("ledger")
      ) {
        operations.push(
          { op: "add_node", label: "Client Application", nodeType: "external", positionHint: "center" },
          { op: "add_node", label: "API Gateway (Kong/Envoy)", nodeType: "gateway", positionHint: "right_of" },
          { op: "add_node", label: "Transaction Service (Command)", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Kafka Event Broker", nodeType: "queue", positionHint: "right_of" },
          { op: "add_node", label: "Ledger Service (Event Store)", nodeType: "service", positionHint: "below" },
          { op: "add_node", label: "Balance Projector", nodeType: "service", positionHint: "above" },
          { op: "add_node", label: "Redis Balance Cache", nodeType: "cache", positionHint: "right_of" },
          { op: "add_node", label: "PostgreSQL Database", nodeType: "database", positionHint: "right_of" },
          { op: "add_edge", sourceId: "Client Application", targetId: "API Gateway (Kong/Envoy)", label: "HTTPS / REST" },
          { op: "add_edge", sourceId: "API Gateway (Kong/Envoy)", targetId: "Transaction Service (Command)", label: "gRPC" },
          { op: "add_edge", sourceId: "Transaction Service (Command)", targetId: "Kafka Event Broker", label: "Produce Event" },
          { op: "add_edge", sourceId: "Kafka Event Broker", targetId: "Ledger Service (Event Store)", label: "Consume Event" },
          { op: "add_edge", sourceId: "Kafka Event Broker", targetId: "Balance Projector", label: "Consume Event" },
          { op: "add_edge", sourceId: "Balance Projector", targetId: "Redis Balance Cache", label: "Update Cache" },
          { op: "add_edge", sourceId: "Ledger Service (Event Store)", targetId: "PostgreSQL Database", label: "Persist SQL" }
        );
      } else if (
        instruction.includes("e-commerce") ||
        instruction.includes("shop") ||
        instruction.includes("store") ||
        lower.includes("commerce")
      ) {
        operations.push(
          { op: "add_node", label: "Customer Web & Mobile App", nodeType: "external", positionHint: "center" },
          { op: "add_node", label: "API Gateway (Kong)", nodeType: "gateway", positionHint: "right_of" },
          { op: "add_node", label: "Product Catalog Service", nodeType: "service", positionHint: "above" },
          { op: "add_node", label: "Elasticsearch (Search Engine)", nodeType: "database", positionHint: "right_of" },
          { op: "add_node", label: "Order & Checkout Service", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "Redis Session Cache", nodeType: "cache", positionHint: "below" },
          { op: "add_node", label: "Kafka Event Queue", nodeType: "queue", positionHint: "right_of" },
          { op: "add_node", label: "PostgreSQL (Orders DB)", nodeType: "database", positionHint: "below" },
          { op: "add_node", label: "Payment Gateway (Stripe)", nodeType: "external", positionHint: "right_of" },
          { op: "add_edge", sourceId: "Customer Web & Mobile App", targetId: "API Gateway (Kong)", label: "HTTPS" },
          { op: "add_edge", sourceId: "API Gateway (Kong)", targetId: "Product Catalog Service", label: "REST" },
          { op: "add_edge", sourceId: "Product Catalog Service", targetId: "Elasticsearch (Search Engine)", label: "Query" },
          { op: "add_edge", sourceId: "API Gateway (Kong)", targetId: "Order & Checkout Service", label: "gRPC" },
          { op: "add_edge", sourceId: "Order & Checkout Service", targetId: "Redis Session Cache", label: "Cart State" },
          { op: "add_edge", sourceId: "Order & Checkout Service", targetId: "Kafka Event Queue", label: "OrderCreated" },
          { op: "add_edge", sourceId: "Order & Checkout Service", targetId: "PostgreSQL (Orders DB)", label: "SQL Write" },
          { op: "add_edge", sourceId: "Order & Checkout Service", targetId: "Payment Gateway (Stripe)", label: "Charge" }
        );
      } else if (!graph.nodes || graph.nodes.length === 0 || instruction.includes("draw") || instruction.includes("create") || instruction.includes("design") || instruction.includes("architecture")) {
        operations.push(
          { op: "add_node", label: "Client Application (Web/Mobile)", nodeType: "external", positionHint: "center" },
          { op: "add_node", label: "API Gateway (Kong/Envoy)", nodeType: "gateway", positionHint: "right_of" },
          { op: "add_node", label: "Core Application Service", nodeType: "service", positionHint: "right_of" },
          { op: "add_node", label: "In-Memory Cache (Redis)", nodeType: "cache", positionHint: "above" },
          { op: "add_node", label: "Kafka Event Broker", nodeType: "queue", positionHint: "below" },
          { op: "add_node", label: "Primary Database (PostgreSQL)", nodeType: "database", positionHint: "right_of" },
          { op: "add_edge", sourceId: "Client Application (Web/Mobile)", targetId: "API Gateway (Kong/Envoy)", label: "HTTPS / REST" },
          { op: "add_edge", sourceId: "API Gateway (Kong/Envoy)", targetId: "Core Application Service", label: "gRPC" },
          { op: "add_edge", sourceId: "Core Application Service", targetId: "In-Memory Cache (Redis)", label: "Cache Read/Write" },
          { op: "add_edge", sourceId: "Core Application Service", targetId: "Kafka Event Broker", label: "Publish Events" },
          { op: "add_edge", sourceId: "Core Application Service", targetId: "Primary Database (PostgreSQL)", label: "SQL Transaction" }
        );
      } else {
        // Find relevant anchor nodes
        const checkoutNode = graph.nodes?.find((n: any) => n.id.includes("checkout") || n.label.toLowerCase().includes("checkout"));
        const gatewayNode = graph.nodes?.find((n: any) => n.id.includes("gateway") || n.label.toLowerCase().includes("gateway"));
        const dbNode = graph.nodes?.find((n: any) => n.id.includes("postgres") || n.label.toLowerCase().includes("postgres") || n.id.includes("db"));
        const clientNode = graph.nodes?.find((n: any) => n.id.includes("client") || n.label.toLowerCase().includes("client"));
        const anchorNodeId = (checkoutNode || dbNode || gatewayNode || graph.nodes?.[0])?.id;

        // Handle removals
        if (lower.includes("remove") || lower.includes("delete")) {
          const targetNode = graph.nodes?.find((n: any) => {
            const l = n.label.toLowerCase();
            if (lower.includes("stripe") && l.includes("stripe")) return true;
            if (lower.includes("redis") && l.includes("redis")) return true;
            if (lower.includes("kafka") && l.includes("kafka")) return true;
            if (lower.includes("postgres") && l.includes("postgres")) return true;
            if (lower.includes("gateway") && l.includes("gateway")) return true;
            return false;
          });
          if (targetNode) {
            operations.push({ op: "remove_node", id: targetNode.id });
          }
        }
        // Handle insert_between
        else if ((lower.includes("between") || lower.includes("in front of")) && checkoutNode && dbNode) {
          operations.push({
            op: "insert_between",
            sourceId: checkoutNode.id,
            targetId: dbNode.id,
            newNode: {
              label: lower.includes("redis") ? "Redis Cache" : "Caching Layer",
              nodeType: "cache",
            },
          });
        }
        // Specific architectural additions
        else if (lower.includes("redis") || lower.includes("cache")) {
          operations.push({
            op: "add_node",
            label: "Redis Cache",
            nodeType: "cache",
            positionHint: "right_of",
            anchorNodeId: checkoutNode ? checkoutNode.id : anchorNodeId,
          });
        } else if (lower.includes("kafka") || lower.includes("queue") || lower.includes("rabbitmq") || lower.includes("sqs")) {
          operations.push({
            op: "add_node",
            label: lower.includes("rabbitmq") ? "RabbitMQ" : "Kafka Queue",
            nodeType: "queue",
            positionHint: "below",
            anchorNodeId: checkoutNode ? checkoutNode.id : anchorNodeId,
          });
        } else if (lower.includes("elasticsearch") || lower.includes("search")) {
          operations.push({
            op: "add_node",
            label: "Elasticsearch",
            nodeType: "database",
            positionHint: "right_of",
            anchorNodeId: dbNode ? dbNode.id : anchorNodeId,
          });
        } else if (lower.includes("mongodb") || lower.includes("dynamo")) {
          operations.push({
            op: "add_node",
            label: lower.includes("dynamo") ? "DynamoDB" : "MongoDB",
            nodeType: "database",
            positionHint: "below",
            anchorNodeId: dbNode ? dbNode.id : anchorNodeId,
          });
        } else if (lower.includes("auth")) {
          operations.push({
            op: "add_node",
            label: "Auth Service",
            nodeType: "service",
            positionHint: "above",
            anchorNodeId: gatewayNode ? gatewayNode.id : anchorNodeId,
          });
        } else if (lower.includes("s3") || lower.includes("storage") || lower.includes("blob")) {
          operations.push({
            op: "add_node",
            label: "S3 Storage",
            nodeType: "external",
            positionHint: "below",
            anchorNodeId: checkoutNode ? checkoutNode.id : anchorNodeId,
          });
        } else if (lower.includes("notification") || lower.includes("email")) {
          operations.push({
            op: "add_node",
            label: "Notification Worker",
            nodeType: "service",
            positionHint: "below",
            anchorNodeId: checkoutNode ? checkoutNode.id : anchorNodeId,
          });
        } else if (lower.includes("gateway") || lower.includes("ingress") || lower.includes("cdn")) {
          operations.push({
            op: "add_node",
            label: lower.includes("cdn") ? "Cloudflare CDN" : "API Gateway",
            nodeType: "gateway",
            positionHint: "left_of",
            anchorNodeId: clientNode ? clientNode.id : anchorNodeId,
          });
        } else {
          operations.push({
            op: "add_node",
            label: "Analytics Worker",
            nodeType: "service",
            positionHint: "below",
            anchorNodeId,
          });
        }
      }

      return {
        content: JSON.stringify({ operations }),
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 280,
        providerIndex: 0,
      };
    }

    // Conversational Architectural Advisory
    if (lower.includes("calculator")) {
      return {
        content: `### Calculator System Architecture\nI've designed the calculator architecture on your board as a structured left-to-right diagram.\n\nWeb, mobile, and public API clients go through an API Gateway that handles auth, rate limiting, and routing. The gateway sends requests to the calculation service. There, a tokenizer and parser turns the expression into an Abstract Syntax Tree (AST) and a validator checks syntax, divide-by-zero, and limits. An evaluator engine then runs the calculation using basic operations (+, -, *, /) and scientific operations (trig, log, powers). A Redis cache stores repeated calculation results for instant lookups. A separate History Service stores users and past calculations in PostgreSQL. Logging, metrics, and alerts monitor the gateway and evaluator.\n\nWhenever you want to modify, add components (e.g. "Add a Currency Converter", "Add Redis Cache"), or remove components (e.g. "Delete Redis cache"), let me know and I will update your whiteboard!`,
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 310,
        providerIndex: 0,
      };
    } else if (lower.includes("uber") || lower.includes("ride") || lower.includes("delivery") || lower.includes("doordash")) {
      return {
        content: `### Real-Time Dispatch & Mobility System Architecture\nI've designed the ride-hailing and dispatch architecture on your board as a structured left-to-right diagram.\n\nRider and Driver mobile apps communicate through an API Gateway (Envoy) over HTTPS and WebSocket connections for real-time location streaming. The gateway forwards ride requests to a Matching & Dispatch Engine, which queries a Redis Geospatial cluster for nearby available drivers. Once a match is confirmed, trip lifecycle events are published to a Kafka event broker. A Trip & Ledger Service consumes these events and persists records into PostgreSQL, while asynchronously triggering the Stripe Payment Gateway for fare processing and dispatching push notifications.\n\nYou can ask me to modify, connect new microservices, or remove components at any time!`,
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 310,
        providerIndex: 0,
      };
    } else if (lower.includes("ledger") || lower.includes("financial") || lower.includes("transaction") || lower.includes("bank")) {
      return {
        content: `### Real-Time Financial Ledger & Transaction Processing Architecture\nI've designed the financial ledger architecture on your board following CQRS and Event Sourcing patterns.\n\nClient applications submit payments to an API Gateway with strict mTLS and rate limiting. The command path routes through a high-throughput Transaction Service, which appends immutable financial events to an Apache Kafka broker. An Event Sourcing Ledger Service consumes events and writes double-entry bookkeeping records into a sharded PostgreSQL cluster. Simultaneously, a Balance Projector maintains real-time customer balances in a Redis cluster for sub-millisecond read access.\n\nLet me know if you would like to insert a fraud-detection engine or update any data flow!`,
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 310,
        providerIndex: 0,
      };
    }

    const topic = lower.includes("checkout") || lower.includes("e-commerce") || lower.includes("shop")
      ? "E-Commerce Checkout & Payment Platform"
      : "High-Availability Distributed Cloud Architecture";

    return {
      content: `### ${topic}\nI've analyzed the system requirements and designed the architecture on your whiteboard as a structured multi-tier diagram.\n\n1. **Clients Tier**: Mobile and Web applications communicate securely over HTTPS with WebSocket support for real-time event updates.\n2. **Edge & Ingress**: Cloud API Gateway terminating TLS, enforcing JWT authentication, rate limiting, and intelligent load balancing.\n3. **Application Services**: Decoupled microservices handling business domain logic with independent autoscaling.\n4. **Event Streaming & Caching**: Apache Kafka message queue for asynchronous decoupling and Redis in-memory caching for sub-millisecond reads.\n5. **Persistence**: Transactional PostgreSQL database cluster with read-replicas for durable relational data.\n\nYou can instruct me to add, delete, or modify any component (e.g. "Add a Redis cache", "Delete PostgreSQL", "Insert Kafka between Gateway and Service")!`,
      provider: "local-synthesizer",
      model: "rule-engine",
      tokens: 290,
      providerIndex: 0,
    };
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

  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  setDailyUsage(providerName: string, count: number): void {
    this.dailyUsage.set(providerName, count);
  }
}
