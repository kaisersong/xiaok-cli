import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
const SCHEMA_VERSION = 1;
class FileBackgroundJobStore {
    rootDir;
    recoverInterruptedJobs;
    jobs = new Map();
    ownerId = randomUUID();
    constructor(rootDir, recoverInterruptedJobs) {
        this.rootDir = rootDir;
        this.recoverInterruptedJobs = recoverInterruptedJobs;
        this.loadExisting();
    }
    create(input) {
        const now = Date.now();
        const job = {
            ...input,
            jobId: `job_${randomUUID()}`,
            ownerId: this.ownerId,
            ownerPid: process.pid,
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
        if (current.ownerId !== this.ownerId || current.ownerPid !== process.pid) {
            throw new Error(`BACKGROUND_JOB_OWNERSHIP_CHANGED: ${jobId}`);
        }
        const durable = JSON.parse(readFileSync(join(this.rootDir, `${jobId}.json`), 'utf8'));
        if (durable.ownerId !== this.ownerId || durable.ownerPid !== process.pid) {
            const { schemaVersion: _version, ...foreign } = durable;
            this.jobs.set(jobId, foreign);
            throw new Error(`BACKGROUND_JOB_OWNERSHIP_CHANGED: ${jobId}`);
        }
        const next = {
            ...current,
            ...patch,
            ownerId: this.ownerId,
            ownerPid: process.pid,
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
            const recovered = this.recoverInterruptedJobs && !ownerMayBeAlive(job.ownerPid)
                && (job.status === 'queued' || job.status === 'running')
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
        }
    }
    persist(job) {
        const doc = {
            schemaVersion: SCHEMA_VERSION,
            ...job,
        };
        writeFileAtomicallySync(join(this.rootDir, `${job.jobId}.json`), JSON.stringify(doc, null, 2));
    }
}
function ownerMayBeAlive(pid) {
    if (pid === undefined)
        return true; // A legacy record is not proof that its older CLI has exited.
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return true;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code !== 'ESRCH';
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
    const active = new Map();
    let disposed = false;
    let shutdown;
    return {
        async start(input) {
            if (disposed)
                throw new Error('background runner is disposed');
            const job = store.create({
                sessionId: input.sessionId,
                source: input.source,
                taskId: input.taskId,
                metadata: input.metadata,
                inputSummary: summarizeInput(input.input),
                status: 'queued',
            });
            const controller = new AbortController();
            const execution = Promise.resolve().then(async () => {
                if (disposed || controller.signal.aborted)
                    return;
                let current = store.update(job.jobId, {
                    status: 'running',
                    startedAt: Date.now(),
                }) ?? job;
                try {
                    const result = await options.execute({ job: current, input: input.input, signal: controller.signal });
                    if (disposed)
                        return;
                    current = store.update(job.jobId, {
                        status: result.ok ? 'completed' : 'failed',
                        finishedAt: Date.now(),
                        resultSummary: result.summary,
                        errorMessage: result.ok ? undefined : result.errorMessage ?? 'background job failed',
                    }) ?? current;
                }
                catch (error) {
                    if (disposed)
                        return;
                    current = store.update(job.jobId, {
                        status: 'failed',
                        finishedAt: Date.now(),
                        errorMessage: error instanceof Error ? error.message : String(error),
                    }) ?? current;
                }
                if (disposed)
                    return;
                try {
                    await options.notify(current);
                }
                catch {
                    // Notification failures should not destabilize the background job lifecycle.
                }
            }).finally(() => { active.delete(job.jobId); });
            active.set(job.jobId, { controller, execution });
            void execution.catch((error) => {
                console.warn(`BACKGROUND_JOB_LIFECYCLE_FAILED: ${job.jobId}: ${String(error)}`);
            });
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
        async dispose() {
            if (!shutdown) {
                disposed = true;
                const errors = [];
                for (const [jobId, task] of active) {
                    try {
                        const job = store.get(jobId);
                        if (job?.status === 'queued' || job?.status === 'running') {
                            store.update(jobId, { status: 'failed', finishedAt: Date.now(),
                                errorMessage: 'BACKGROUND_RUNNER_DISPOSED: host requested shutdown; execution may still be settling',
                            });
                        }
                    }
                    catch (error) {
                        errors.push(error);
                    }
                    finally {
                        task.controller.abort();
                    }
                }
                shutdown = (async () => {
                    let timer;
                    try {
                        await Promise.race([
                            Promise.allSettled([...active.values()].map((task) => task.execution)),
                            new Promise((resolve) => { timer = setTimeout(resolve, Math.max(1, options.shutdownTimeoutMs ?? 500)); }),
                        ]);
                    }
                    finally {
                        if (timer)
                            clearTimeout(timer);
                    }
                    if (errors.length)
                        throw new AggregateError(errors, 'background shutdown state persistence failed');
                })();
            }
            await shutdown;
            const pendingJobs = [...active.keys()];
            return { settled: pendingJobs.length === 0, pendingJobs };
        },
    };
}
