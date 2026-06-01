import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface KSwarmInitialPlanBootstrapPayload {
  projectId: string;
  projectName: string;
  goal: string;
  requirements: string;
  planningGuidance: string;
  poAgent: string;
  members: string[];
}

export interface KSwarmInitialPlanBootstrapJob extends KSwarmInitialPlanBootstrapPayload {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface StoreData {
  jobs: KSwarmInitialPlanBootstrapJob[];
}

const FILE_NAME = 'kswarm-initial-plan-bootstrap-jobs.json';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

export class JsonKSwarmInitialPlanBootstrapStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true });
    this.filePath = join(dataRoot, FILE_NAME);
  }

  upsertPending(input: KSwarmInitialPlanBootstrapPayload, now: number): KSwarmInitialPlanBootstrapJob {
    const data = this.load();
    const existing = data.jobs.find(job => job.projectId === input.projectId);
    if (existing) {
      Object.assign(existing, {
        ...input,
        updatedAt: now,
      });
      if (existing.status === 'failed') {
        existing.status = 'pending';
        existing.nextAttemptAt = now;
        existing.lastError = undefined;
      }
      this.save(data);
      return { ...existing };
    }

    const job: KSwarmInitialPlanBootstrapJob = {
      id: input.projectId,
      ...input,
      status: 'pending',
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    data.jobs.push(job);
    this.save(data);
    return { ...job };
  }

  claimDue(now: number, limit: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): KSwarmInitialPlanBootstrapJob[] {
    const data = this.load();
    const due = data.jobs
      .filter(job => isDue(job, now, staleAfterMs))
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);

    for (const job of due) {
      job.status = 'running';
      job.updatedAt = now;
    }
    if (due.length > 0) this.save(data);
    return due.map(job => ({ ...job, members: [...job.members] }));
  }

  hasDue(now: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): boolean {
    return this.load().jobs.some(job => isDue(job, now, staleAfterMs));
  }

  nextDueAt(now: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): number | null {
    const candidates = this.load().jobs
      .map(job => {
        if (job.status === 'pending') return job.nextAttemptAt;
        if (job.status === 'running') return job.updatedAt + staleAfterMs;
        return null;
      })
      .filter((value): value is number => typeof value === 'number');
    if (candidates.length === 0) return null;
    return Math.max(now, Math.min(...candidates));
  }

  markSucceeded(projectId: string, now: number): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    if (!job) return;
    job.status = 'succeeded';
    job.updatedAt = now;
    job.completedAt = now;
    job.lastError = undefined;
    this.save(data);
  }

  markFailed(projectId: string, now: number, error: string): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    if (!job) return;
    job.attempts += 1;
    job.lastError = error;
    job.updatedAt = now;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
    } else {
      job.status = 'pending';
      job.nextAttemptAt = now + Math.min(60_000 * Math.pow(2, job.attempts - 1), 30 * 60_000);
    }
    this.save(data);
  }

  list(): KSwarmInitialPlanBootstrapJob[] {
    return this.load().jobs.map(job => ({ ...job, members: [...job.members] }));
  }

  private load(): StoreData {
    if (!existsSync(this.filePath)) return { jobs: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreData>;
      return {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs.filter(isJob) : [],
      };
    } catch {
      return { jobs: [] };
    }
  }

  private save(data: StoreData): void {
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmpPath, this.filePath);
  }
}

export class KSwarmInitialPlanBootstrapQueue {
  private scheduled = false;
  private scheduledFor: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: JsonKSwarmInitialPlanBootstrapStore,
    private readonly execute: (job: KSwarmInitialPlanBootstrapPayload) => Promise<{ ok: true } | { ok: false; error: string }>,
    private readonly options: {
      now?: () => number;
      maxClaimPerRun?: number;
      setTimeoutFn?: (callback: () => void, ms: number) => NodeJS.Timeout;
    } = {}
  ) {}

  enqueue(input: KSwarmInitialPlanBootstrapPayload): { ok: true; status: 'queued' } | { ok: false; error: string } {
    try {
      this.store.upsertPending(input, this.now());
      this.kick();
      return { ok: true, status: 'queued' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  startRecovery(): void {
    this.kick();
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const limit = this.options.maxClaimPerRun ?? 5;
      while (true) {
        const jobs = this.store.claimDue(this.now(), limit);
        if (jobs.length === 0) break;
        for (const job of jobs) {
          const result = await this.execute(job);
          const now = this.now();
          if (result.ok) {
            this.store.markSucceeded(job.projectId, now);
          } else {
            this.store.markFailed(job.projectId, now, result.error);
          }
        }
      }
    } finally {
      this.running = false;
      const now = this.now();
      const nextDueAt = this.store.nextDueAt(now);
      if (nextDueAt !== null) {
        this.kick(Math.max(0, nextDueAt - now));
      }
    }
  }

  private kick(delayMs = 0): void {
    const targetAt = this.now() + delayMs;
    if (this.scheduled && this.scheduledFor !== null && this.scheduledFor <= targetAt) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = true;
    this.scheduledFor = targetAt;
    this.timer = (this.options.setTimeoutFn ?? setTimeout)(() => {
      this.scheduled = false;
      this.scheduledFor = null;
      this.timer = null;
      void this.runOnce();
    }, delayMs);
    this.timer.unref?.();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function isJob(value: unknown): value is KSwarmInitialPlanBootstrapJob {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.projectId === 'string'
    && typeof record.projectName === 'string'
    && typeof record.goal === 'string'
    && typeof record.poAgent === 'string'
    && Array.isArray(record.members)
    && typeof record.status === 'string'
    && typeof record.attempts === 'number'
    && typeof record.maxAttempts === 'number'
    && typeof record.nextAttemptAt === 'number';
}

function isDue(job: KSwarmInitialPlanBootstrapJob, now: number, staleAfterMs: number): boolean {
  return (job.status === 'pending' && job.nextAttemptAt <= now) ||
    (job.status === 'running' && job.updatedAt <= now - staleAfterMs);
}
