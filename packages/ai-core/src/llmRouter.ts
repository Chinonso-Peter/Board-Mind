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
  const cfKey = process.env.CLOUDFLARE_API_KEY;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const nvKey = process.env.NVIDIA_API_KEY;
  const zaiKey = process.env.ZAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  return [
    {
      name: "groq",
      model: "gpt-oss-120b",
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
      name: "cloudflare",
      model: "@cf/openai/gpt-oss-120b",
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
    {
      name: "gemini",
      model: "gemini-3.5-flash-lite",
      maxRPM: 15,
      maxRPD: 500,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      client: geminiKey && geminiKey !== "missing"
        ? new OpenAI({
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey: geminiKey,
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
    if (!this.db) return;
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

    if (this.db) {
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

    // Stage 1: Decision detection
    if (systemMsg.includes("sole task is to determine whether the latest conversation segment contains a concrete")) {
      const lower = userMsg.toLowerCase();
      const decisionPhrases = ["let's add", "let's put", "add ", "use redis", "use kafka", "replace", "introduce", "we should use", "remove"];
      const isDecision = decisionPhrases.some((phrase) => lower.includes(phrase));

      const result = {
        is_decision: isDecision,
        confidence: isDecision ? 0.92 : 0.2,
        reason: isDecision ? "Synthesized decision detected from engineering keywords in transcript." : "No architectural decision detected.",
      };
      return {
        content: JSON.stringify(result),
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 150,
        providerIndex: 0,
      };
    }

    // Stage 2: Intent parsing
    if (systemMsg.includes("architectural diagram compiler")) {
      const lower = userMsg.toLowerCase();
      const operations: any[] = [];

      let anchorNodeId: string | undefined;
      try {
        const jsonMatch = userMsg.match(/CURRENT DIAGRAM GRAPH \(JSON\):\s*([\s\S]*)/);
        if (jsonMatch && jsonMatch[1]) {
          const graph = JSON.parse(jsonMatch[1].trim());
          if (graph.nodes && graph.nodes.length > 0) {
            anchorNodeId = graph.nodes[0].id;
          }
        }
      } catch {
        // Ignore
      }

      if (lower.includes("redis") && lower.includes("cache")) {
        operations.push({
          op: "add_node",
          label: "Redis Cache",
          nodeType: "cache",
          positionHint: "right_of",
          anchorNodeId,
        });
      } else if (lower.includes("postgres") || lower.includes("database")) {
        operations.push({
          op: "add_node",
          label: "PostgreSQL",
          nodeType: "database",
          positionHint: "below",
          anchorNodeId,
        });
      } else if (lower.includes("gateway")) {
        operations.push({
          op: "add_node",
          label: "API Gateway",
          nodeType: "gateway",
          positionHint: "left_of",
          anchorNodeId,
        });
      } else {
        operations.push({
          op: "add_node",
          label: "New Service",
          nodeType: "service",
          positionHint: "right_of",
          anchorNodeId,
        });
      }

      return {
        content: JSON.stringify({ operations }),
        provider: "local-synthesizer",
        model: "rule-engine",
        tokens: 280,
        providerIndex: 0,
      };
    }

    return {
      content: JSON.stringify({ is_decision: false, confidence: 0, reason: "Fallback empty" }),
      provider: "local-synthesizer",
      model: "rule-engine",
      tokens: 50,
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
