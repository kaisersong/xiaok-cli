import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const SCHEMA_VERSION = 1;
class FileBackgroundJobStore {
    rootDir;
    recoverInterruptedJobs;
    jobs = new Map();
    nextId = 1;
    constructor(rootDir, recoverInterruptedJobs) {
        this.rootDir = rootDir;
        this.recoverInterruptedJobs = recoverInterruptedJobs;
        this.loadExisting();
    }
    create(input) {
        const now = Date.now();
        const job = {
            ...input,
            jobId: `job_${this.nextId++}`,
            createdAt: now,
            updatedAt: now,
        };
        this.jobs.set(job.jobId, job);
        this.persist(job);
        return job;
    }
    get(jobId) {
        return this.jobs.get(jobId);
    }
    listBySession(sessionId) {
        return [...this.jobs.values()]
            .filter((job) => job.sessionId === sessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    listByTask(taskId) {
        return [...this.jobs.values()]
            .filter((job) => job.taskId === taskId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    update(jobId, patch) {
        const current = this.jobs.get(jobId);
        if (!current) {
            return undefined;
        }
        const next = {
            ...current,
            ...patch,
            updatedAt: Date.now(),
        };
        this.jobs.set(jobId, next);
        this.persist(next);
        return next;
    }
    loadExisting() {
        if (!existsSync(this.rootDir)) {
            return;
        }
        const docs = readdirSync(this.rootDir).filter((entry) => entry.endsWith('.json'));
        for (const entry of docs) {
            const raw = readFileSync(join(this.rootDir, entry), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.schemaVersion !== SCHEMA_VERSION) {
                continue;
            }
            const { schemaVersion: _schemaVersion, ...job } = parsed;
            const recovered = this.recoverInterruptedJobs && (job.status === 'queued' || job.status === 'running')
                ? {
                    ...job,
                    status: 'failed',
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
    persist(job) {
        mkdirSync(this.rootDir, { recursive: true });
        const doc = {
            schemaVersion: SCHEMA_VERSION,
            ...job,
        };
        writeFileSync(join(this.rootDir, `${job.jobId}.json`), JSON.stringify(doc, null, 2), 'utf8');
    }
}
function summarizeInput(input) {
    if (typeof input === 'string') {
        return input;
    }
    return JSON.stringify(input);
}
export function createBackgroundRunner(options) {
    const store = new FileBackgroundJobStore(options.rootDir, options.recoverInterruptedJobs ?? true);
    return {
        async start(input) {
            const job = store.create({
                sessionId: input.sessionId,
                source: input.source,
                taskId: input.taskId,
                metadata: input.metadata,
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
                }
                catch (error) {
                    current = store.update(job.jobId, {
                        status: 'failed',
                        finishedAt: Date.now(),
                        errorMessage: error instanceof Error ? error.message : String(error),
                    }) ?? current;
                }
                try {
                    await options.notify(current);
                }
                catch {
                    // Notification failures should not destabilize the background job lifecycle.
                }
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
