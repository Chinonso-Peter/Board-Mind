import Database from "better-sqlite3";

export class UsageTracker {
  private dailyUsage = new Map<string, number>();
  private currentUtcDate: string;

  constructor(private db: Database.Database) {
    this.currentUtcDate = this.getTodayUtc();
    this.loadFromDb();
  }

  private getTodayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private ensureCurrentUtcDay(): void {
    const today = this.getTodayUtc();
    if (today !== this.currentUtcDate) {
      this.currentUtcDate = today;
      this.dailyUsage.clear();
      this.loadFromDb();
    }
  }

  private loadFromDb(): void {
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
      // Ignore if table not yet initialized in tests
    }
  }

  getDailyRequests(providerName: string): number {
    this.ensureCurrentUtcDay();
    return this.dailyUsage.get(providerName) ?? 0;
  }

  increment(providerName: string, requests = 1, tokens = 0): void {
    this.ensureCurrentUtcDay();
    const current = (this.dailyUsage.get(providerName) ?? 0) + requests;
    this.dailyUsage.set(providerName, current);

    try {
      const upsert = this.db.prepare(`
        INSERT INTO provider_usage (provider_name, date, requests_used, tokens_used)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(provider_name, date) DO UPDATE SET
          requests_used = requests_used + excluded.requests_used,
          tokens_used = tokens_used + excluded.tokens_used
      `);
      upsert.run(providerName, this.currentUtcDate, requests, tokens);
    } catch (err: any) {
      console.warn(`[UsageTracker] DB write failed: ${err.message}`);
    }
  }
}
