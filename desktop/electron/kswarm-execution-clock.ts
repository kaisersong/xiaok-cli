/** Main-owned execution start, distinct from queue admission. */
export function resolveKSwarmProjectWorkerCapacity(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10 ? value : 3;
}

export function resolveKSwarmWorkerRunMs(task: { evidenceContract?: unknown }): number {
  const contract = task.evidenceContract as Record<string, unknown> | undefined;
  return contract?.version === 1 && contract.kind === 'external_source_v1' && contract.required === true
    ? 60 * 60 * 1000 : 20 * 60 * 1000;
}

export class KSwarmExecutionClock {
  private startedAt?: number;
  constructor(private readonly maxRunMs = 20 * 60 * 1000) {}
  start(now = Date.now()): void { this.startedAt ??= now; }
  expired(now = Date.now()): boolean { return this.startedAt !== undefined && now - this.startedAt >= this.maxRunMs; }
}
