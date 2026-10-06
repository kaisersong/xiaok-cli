/** Main-owned execution start, distinct from queue admission. */
export class KSwarmExecutionClock {
  private startedAt?: number;
  constructor(private readonly maxRunMs = 20 * 60 * 1000) {}
  start(now = Date.now()): void { this.startedAt ??= now; }
  expired(now = Date.now()): boolean { return this.startedAt !== undefined && now - this.startedAt >= this.maxRunMs; }
}
