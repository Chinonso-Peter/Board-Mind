import OpenAI, { toFile } from "openai";
import { UsageTracker } from "./usageTracker.js";
import { CircuitBreaker } from "./circuitBreaker.js";

export interface TranscriptResult {
  text: string;
  provider: "groq-whisper" | "openai-whisper" | "cloudflare-whisper" | "fallback-whisper";
  durationMs: number;
  language: string;
}

export interface VoiceProviderAdapter {
  transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscriptResult>;
}

export class MultiProviderVoiceAdapter implements VoiceProviderAdapter {
  private groqClient: OpenAI | null = null;
  private openaiClient: OpenAI | null = null;
  private groqBreaker = new CircuitBreaker("groq-whisper");
  private openaiBreaker = new CircuitBreaker("openai-whisper");
  private cfBreaker = new CircuitBreaker("cloudflare-whisper");

  constructor(
    private usageTracker: UsageTracker,
    private mockTranscribe?: (buffer: Buffer, mime: string) => Promise<string>
  ) {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && groqKey !== "missing") {
      this.groqClient = new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        timeout: 15_000,
      });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && openaiKey !== "missing") {
      this.openaiClient = new OpenAI({
        baseURL: "https://api.openai.com/v1",
        apiKey: openaiKey,
        timeout: 15_000,
      });
    }
  }

  // Filter out silence / hallucination strings common with Whisper
  private filterHallucinations(text: string): string {
    const cleaned = text.trim();
    const hallucinations = [
      "thank you.",
      "thank you",
      "thanks for watching",
      "thanks for watching!",
      "[blank_audio]",
      "[applause]",
      "subtitles by",
      "subtitles created by",
      "subscribe",
      "you",
    ];
    if (hallucinations.includes(cleaned.toLowerCase())) {
      return "";
    }
    return cleaned;
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    language = "en"
  ): Promise<TranscriptResult> {
    const start = Date.now();
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";

    // 0. If test mock provided, use it
    if (this.mockTranscribe) {
      const text = await this.mockTranscribe(audioBuffer, mimeType);
      return {
        text: this.filterHallucinations(text),
        provider: "fallback-whisper",
        durationMs: Date.now() - start,
        language,
      };
    }

    // 1. Primary: Groq Whisper (whisper-large-v3)
    if (
      this.groqClient &&
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
          text: this.filterHallucinations(response.text),
          provider: "groq-whisper",
          durationMs: Date.now() - start,
          language,
        };
      } catch (err: any) {
        this.groqBreaker.recordFailure();
        console.warn(`[VoiceAdapter] Groq Whisper error: ${err.message}`);
      }
    }

    // 2. Secondary: OpenAI Whisper (whisper-1)
    if (
      this.openaiClient &&
      this.openaiBreaker.shouldAttempt() &&
      this.usageTracker.getDailyRequests("openai-whisper") < 2000
    ) {
      try {
        const file = await toFile(audioBuffer, `chunk.${ext}`, { type: mimeType });
        const response = await this.openaiClient.audio.transcriptions.create({
          file,
          model: "whisper-1",
          language,
          response_format: "json",
          temperature: 0.0,
        });

        this.openaiBreaker.recordSuccess();
        this.usageTracker.increment("openai-whisper", 1, Math.ceil(audioBuffer.length / 1024));

        return {
          text: this.filterHallucinations(response.text),
          provider: "openai-whisper",
          durationMs: Date.now() - start,
          language,
        };
      } catch (err: any) {
        this.openaiBreaker.recordFailure();
        console.warn(`[VoiceAdapter] OpenAI Whisper error: ${err.message}`);
      }
    }

    // 2. Fallback: Cloudflare Workers AI Whisper
    const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const cfKey = process.env.CLOUDFLARE_API_KEY;
    if (
      cfAccount &&
      cfKey &&
      cfKey !== "missing" &&
      this.cfBreaker.shouldAttempt() &&
      this.usageTracker.getDailyRequests("cloudflare-whisper") < 5000
    ) {
      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/@cf/openai/whisper`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfKey}`,
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
          text: this.filterHallucinations(payload.result?.text ?? ""),
          provider: "cloudflare-whisper",
          durationMs: Date.now() - start,
          language,
        };
      } catch (err: any) {
        this.cfBreaker.recordFailure();
        console.warn(`[VoiceAdapter] Cloudflare Whisper error: ${err.message}`);
      }
    }

    // Fallback stub if no cloud API keys are present (allows local dev without spending quota)
    return {
      text: "[Voice transcription: cloud API keys not configured]",
      provider: "fallback-whisper",
      durationMs: Date.now() - start,
      language,
    };
  }
}
