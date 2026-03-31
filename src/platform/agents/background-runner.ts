import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackgroundJobRecord {
  jobId: string;
  sessionId: string;
  source: string;
  taskId?: string;
  inputSummary: string;
  status: BackgroundJobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  resultSummary?: string;
  errorMessage?: string;
}

export interface StartBackgroundJobInput {
  sessionId: string;
  source: string;
  taskId?: string;
  input: unknown;
}

export interface BackgroundExecutionResult {
  ok: boolean;
  summary?: string;
  errorMessage?: string;
}

export interface BackgroundExecutionContext {
  job: BackgroundJobRecord;
  input: unknown;
}

export interface BackgroundRunnerOptions {
  rootDir: string;
  execute(context: BackgroundExecutionContext): Promise<BackgroundExecutionResult>;
  notify(job: BackgroundJobRecord): Promise<void> | void;
}

const SCHEMA_VERSION = 1;

interface PersistedBackgroundJobDocument extends BackgroundJobRecord {
  schemaVersion: number;
}

class FileBackgroundJobStore {
  private readonly jobs = new Map<string, BackgroundJobRecord>();
  private nextId = 1;

  constructor(private readonly rootDir: string) {
    this.loadExisting();
  }

  create(input: Omit<BackgroundJobRecord, 'jobId' | 'createdAt' | 'updatedAt'>): BackgroundJobRecord {
    const now = Date.now();
    const job: BackgroundJobRecord = {
      ...input,
      jobId: `job_${this.nextId++}`,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.jobId, job);
    this.persist(job);
    return job;
  }

  get(jobId: string): BackgroundJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  listBySession(sessionId: string): BackgroundJobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listByTask(taskId: string): BackgroundJobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => job.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  update(jobId: string, patch: Partial<BackgroundJobRecord>): BackgroundJobRecord | undefined {
    const current = this.jobs.get(jobId);
    if (!current) {
      return undefined;
    }

    const next: BackgroundJobRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, next);
    this.persist(next);
    return next;
  }

  private loadExisting(): void {
    if (!existsSync(this.rootDir)) {
      return;
    }

    const docs = readdirSync(this.rootDir).filter((entry) => entry.endsWith('.json'));
    for (const entry of docs) {
      const raw = readFileSync(join(this.rootDir, entry), 'utf8');
      const parsed = JSON.parse(raw) as PersistedBackgroundJobDocument;
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        continue;
      }

      const { schemaVersion: _schemaVersion, ...job } = parsed;
      const recovered = job.status === 'queued' || job.status === 'running'
        ? {
            ...job,
            status: 'failed' as const,
            finishedAt: job.finishedAt ?? Date.now(),
            errorMessage: job.errorMessage ?? 'background job interrupted by process restart',
            updatedAt: Date.now(),
          }
        : job;
      this.jobs.set(recovered.jobId, recovered);
      if (recovered !== job) {
        this.persist(recovered);
      }
      const seq = Number(job.jobId.replace(/^job_/, ''));
      if (Number.isFinite(seq) && seq >= this.nextId) {
        this.nextId = seq + 1;
      }
    }
  }

  private persist(job: BackgroundJobRecord): void {
    mkdirSync(this.rootDir, { recursive: true });
    const doc: PersistedBackgroundJobDocument = {
      schemaVersion: SCHEMA_VERSION,
      ...job,
    };
    writeFileSync(join(this.rootDir, `${job.jobId}.json`), JSON.stringify(doc, null, 2), 'utf8');
  }
}

export interface BackgroundRunner {
  start(input: StartBackgroundJobInput): Promise<BackgroundJobRecord>;
  get(jobId: string): BackgroundJobRecord | undefined;
  listBySession(sessionId: string): BackgroundJobRecord[];
  listByTask(taskId: string): BackgroundJobRecord[];
}

function summarizeInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  return JSON.stringify(input);
}

export function createBackgroundRunner(options: BackgroundRunnerOptions): BackgroundRunner {
  const store = new FileBackgroundJobStore(options.rootDir);

  return {
    async start(input) {
      const job = store.create({
        sessionId: input.sessionId,
        source: input.source,
        taskId: input.taskId,
        inputSummary: summarizeInput(input.input),
        status: 'queued',
      });

      void (async () => {
        let current = store.update(job.jobId, {
          status: 'running',
          startedAt: Date.now(),
        }) ?? job;

        try {
          const result = await options.execute({ job: current, input: input.input });
          current = store.update(job.jobId, {
            status: result.ok ? 'completed' : 'failed',
            finishedAt: Date.now(),
            resultSummary: result.summary,
            errorMessage: result.ok ? undefined : result.errorMessage ?? 'background job failed',
          }) ?? current;
        } catch (error) {
          current = store.update(job.jobId, {
            status: 'failed',
            finishedAt: Date.now(),
            errorMessage: error instanceof Error ? error.message : String(error),
          }) ?? current;
        }

        await options.notify(current);
      })();

      return job;
    },

    get(jobId) {
      return store.get(jobId);
    },

    listBySession(sessionId) {
      return store.listBySession(sessionId);
    },

    listByTask(taskId) {
      return store.listByTask(taskId);
    },
  };
}
