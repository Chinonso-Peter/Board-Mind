export class CircuitBreaker {
  state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  constructor(
    public name: string,
    options: { failureThreshold?: number; resetTimeout?: number } = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeout = options.resetTimeout ?? 60_000;
  }

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
    // HALF_OPEN allows one probe request through
    return true;
  }

  getFailures(): number {
    return this.failures;
  }
}
