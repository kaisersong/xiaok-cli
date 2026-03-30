export class YZJInboundDedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 5 * 60_000) {}

  markSeen(messageId: string): boolean {
    const now = Date.now();
    this.sweep(now);
    if (this.seen.has(messageId)) {
      return false;
    }
    this.seen.set(messageId, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    for (const [messageId, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(messageId);
      }
    }
  }
}
