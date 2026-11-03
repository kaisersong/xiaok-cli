import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {writeFileAtomicallySync} from '../../src/utils/atomic-file.js';

export interface KSwarmInitialPlanBootstrapPayload {
  projectId: string;
  projectName: string;
  goal: string;
  requirements: string;
  planningGuidance: string;
  poAgent: string;
  members: string[];
  startPolicy?: 'plan_only' | 'auto_activate_after_plan' | 'activate_and_dispatch_after_plan';
}

export interface KSwarmInitialPlanBootstrapJob extends KSwarmInitialPlanBootstrapPayload {
  schemaVersion: 2;
  enqueueKey: string;
  payloadHash: string;
  planRunId: string;
  legacyImport?: true;
  claimToken?: string;
  claimGeneration?: number;
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'launch_unknown' | 'legacy_unverified';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface StoreData {
  revision: number;
  jobs: KSwarmInitialPlanBootstrapJob[];
}
export type KSwarmBootstrapEnqueueResult = import('../shared/project-planning-ipc-contract.js').ProjectPlanningOutput;

const FILE_NAME = 'kswarm-initial-plan-bootstrap-jobs.json';
const DEFAULT_MAX_ATTEMPTS = 3;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonicalPayload(input:KSwarmInitialPlanBootstrapPayload):KSwarmInitialPlanBootstrapPayload {
  for (const key of ['projectId','projectName','goal','requirements','planningGuidance','poAgent'] as const) {
    if (typeof input[key]!=='string') throw new Error('bootstrap_payload_invalid');
  }
  if (!input.projectId || !input.poAgent || !Array.isArray(input.members) || input.members.some(member=>typeof member!=='string')
    || input.startPolicy!==undefined && !['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan'].includes(input.startPolicy)) throw new Error('bootstrap_payload_invalid');
  return {projectId:input.projectId,projectName:input.projectName,goal:input.goal,requirements:input.requirements,
    planningGuidance:input.planningGuidance,poAgent:input.poAgent,members:[...input.members],startPolicy:input.startPolicy ?? 'activate_and_dispatch_after_plan'};
}
const enqueueKey=(projectId:string)=>'initial-plan:'+digest(['initial-plan-v2',projectId]);
const payloadHash=(input:KSwarmInitialPlanBootstrapPayload)=>digest(['initial-plan-payload-v2',canonicalPayload(input)]);

export class JsonKSwarmInitialPlanBootstrapStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true });
    this.filePath = join(dataRoot, FILE_NAME);
  }

  upsertPending(input: KSwarmInitialPlanBootstrapPayload, now: number): KSwarmInitialPlanBootstrapJob {
    return this.withJournalLock(()=>this.upsertPendingLocked(input,now));
  }
  private upsertPendingLocked(input: KSwarmInitialPlanBootstrapPayload, now: number): KSwarmInitialPlanBootstrapJob {
    const payload=canonicalPayload(input);
    const data = this.load();
    const existing = data.jobs.find(job => job.projectId === input.projectId);
    if (existing) {
      if(existing.legacyImport)throw new Error('bootstrap_legacy_reconciliation_required');
      if(existing.payloadHash!==payloadHash(payload))throw new Error('bootstrap_payload_conflict');
      return structuredClone(existing);
    }

    const job: KSwarmInitialPlanBootstrapJob = {
      id: input.projectId,
      ...payload,
      schemaVersion:2,
      enqueueKey:enqueueKey(payload.projectId),payloadHash:payloadHash(payload),planRunId:randomUUID(),
      status: 'pending',
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    data.jobs.push(job);
    this.save(data);
    return structuredClone(job);
  }

  claimDue(now: number, limit: number): KSwarmInitialPlanBootstrapJob[] {
    return this.withJournalLock(()=>this.claimDueLocked(now,limit));
  }
  private claimDueLocked(now: number, limit: number): KSwarmInitialPlanBootstrapJob[] {
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error('bootstrap_claim_limit_invalid');
    const data = this.load();
    const due = data.jobs
      .filter(job => isDue(job, now))
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);

    for (const job of due) {
      job.status = 'running';
      job.claimToken=randomUUID();job.claimGeneration=(job.claimGeneration??0)+1;
      job.updatedAt = now;
    }
    if (due.length > 0) this.save(data);
    return due.map(job => ({ ...job, members: [...job.members] }));
  }

  hasDue(now: number): boolean {
    return this.load().jobs.some(job => isDue(job, now));
  }

  nextDueAt(now: number): number | null {
    const candidates = this.load().jobs
      .map(job => {
        if (job.status === 'pending') return job.nextAttemptAt;
        return null;
      })
      .filter((value): value is number => typeof value === 'number');
    if (candidates.length === 0) return null;
    return Math.max(now, Math.min(...candidates));
  }

  markSucceeded(projectId: string, now: number, claimToken:string): void {
    return this.withJournalLock(()=>this.markSucceededLocked(projectId,now,claimToken));
  }
  private markSucceededLocked(projectId: string, now: number, claimToken:string): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    this.assertClaim(job,claimToken);
    job.status = 'succeeded';
    job.updatedAt = now;
    job.completedAt = now;
    job.lastError = undefined;
    this.save(data);
  }

  markFailed(projectId: string, now: number, error: string, claimToken:string): void {
    return this.withJournalLock(()=>this.markFailedLocked(projectId,now,error,claimToken));
  }
  private markFailedLocked(projectId: string, now: number, error: string, claimToken:string): void {
    const data = this.load();
    const job = data.jobs.find(item => item.projectId === projectId);
    this.assertClaim(job,claimToken);
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

  markLaunchUnknown(projectId:string,now:number,error:string,claimToken:string):void {
    return this.withJournalLock(()=>this.markLaunchUnknownLocked(projectId,now,error,claimToken));
  }
  private markLaunchUnknownLocked(projectId:string,now:number,error:string,claimToken:string):void {
    const data=this.load();const job=data.jobs.find(item=>item.projectId===projectId);
    this.assertClaim(job,claimToken);
    job.status='launch_unknown';job.updatedAt=now;job.lastError=error;this.save(data);
  }
  private assertClaim(job:KSwarmInitialPlanBootstrapJob|undefined,claimToken:string):asserts job is KSwarmInitialPlanBootstrapJob {
    if(!job || job.status!=='running' || !claimToken || job.claimToken!==claimToken)throw new Error('bootstrap_claim_conflict');
  }

  private withJournalLock<T>(action:()=>T):T {
    const lockPath=this.filePath+'.lock';let fd:number;
    try{fd=openSync(lockPath,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('bootstrap_journal_busy');throw error;}
    try{
      writeFileSync(fd,JSON.stringify({pid:process.pid,token:randomUUID()}));fsyncSync(fd);
      return action();
    }finally{closeSync(fd);unlinkSync(lockPath);}
    // A crash-held lock is never reclaimed by elapsed time. Recovery must prove
    // the old writer is gone; until then this journal explicitly stays busy.
  }

  list(): KSwarmInitialPlanBootstrapJob[] {
    return this.load().jobs.map(job => ({ ...job, members: [...job.members] }));
  }

  private load(): StoreData {
    if (!existsSync(this.filePath)) return { revision:0,jobs: [] };
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreData>;
    if(!parsed || !Array.isArray(parsed.jobs))throw new Error('bootstrap_journal_invalid');
    const revision=parsed.revision??0;
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error('bootstrap_journal_revision_invalid');
    const ids=new Set<string>();
    const jobs=parsed.jobs.map(raw=>{
      if(!isJob(raw) || ids.has(raw.projectId))throw new Error('bootstrap_journal_invalid');
      ids.add(raw.projectId);const payload=canonicalPayload(raw);
      if(raw.schemaVersion===undefined){
        // Import preserves launch state. It is not authority to relaunch a
        // running legacy process or proof that an owner claim exists.
        return {...raw,...payload,schemaVersion:2 as const,legacyImport:true as const,
          status:['succeeded','failed'].includes(raw.status)?raw.status:'legacy_unverified' as const,
          enqueueKey:enqueueKey(raw.projectId),payloadHash:payloadHash(payload),
          planRunId:'legacy:'+digest([raw.projectId,raw.createdAt])};
      }
      if(raw.schemaVersion!==2 || raw.enqueueKey!==enqueueKey(raw.projectId) || raw.payloadHash!==payloadHash(payload)
        || typeof raw.planRunId!=='string' || !raw.planRunId)throw new Error('bootstrap_identity_invalid');
      return raw as KSwarmInitialPlanBootstrapJob;
    });
    return {revision,jobs};
  }

  private save(data: StoreData): void {
    data.revision+=1;
    writeFileAtomicallySync(this.filePath,JSON.stringify(data,null,2));
  }
}

export class KSwarmInitialPlanBootstrapQueue {
  private scheduled = false;
  private scheduledFor: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private activeController: AbortController | null = null;
  private activeRun: Promise<void> | null = null;
  private queueError: string | null = null;

  constructor(
    private readonly store: JsonKSwarmInitialPlanBootstrapStore,
    /**
     * Design v58 §5.5 / R44-06: the signature explicitly gains `signal` so a
     * shutdown abort reaches the job instead of leaving a fire-and-forget run.
     */
    private readonly execute: (
      job: KSwarmInitialPlanBootstrapJob,
      signal: AbortSignal,
    ) => Promise<{ ok: true } | { ok: false; error: string; launchOutcome?: 'unknown' }>,
    private readonly options: {
      now?: () => number;
      maxClaimPerRun?: number;
      setTimeoutFn?: (callback: () => void, ms: number) => NodeJS.Timeout;
      /** Held for the duration of a run so the coordinator can drain it. */
      acquireRunToken?: () => { release(): void };
      onError?: (error: unknown) => void;
    } = {}
  ) {}

  enqueue(input: KSwarmInitialPlanBootstrapPayload): KSwarmBootstrapEnqueueResult {
    if(this.stopped)return {ok:false,error:'bootstrap_queue_stopped'};
    try {
      const job=this.store.upsertPending(input, this.now());
      if(job.status==='legacy_unverified')return {ok:false,error:'bootstrap_legacy_reconciliation_required'};
      if(job.status==='failed')return {ok:false,error:'bootstrap_attempts_exhausted'};
      if(job.status==='pending')this.kick();
      return { ok: true, status: job.status==='pending'?'queued':job.status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getHealth():{ok:boolean;error:string|null}{return {ok:this.queueError===null,error:this.queueError};}

  startRecovery(): void {
    this.kick();
  }

  /** Shutdown owner API (§5.5 phase ③). */
  stopAccepting(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.scheduled = false;
      this.scheduledFor = null;
    }
  }

  abortActive(reason = 'app_shutdown'): void {
    this.activeController?.abort(reason);
  }

  async drain(): Promise<void> {
    while (this.activeRun) {
      await this.activeRun;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    if (this.stopped) return;
    this.running = true;
    const token = this.options.acquireRunToken?.() ?? null;
    const controller = new AbortController();
    this.activeController = controller;
    let settleRun: () => void = () => {};
    this.activeRun = new Promise<void>((resolve) => { settleRun = resolve; });
    try {
      const limit = this.options.maxClaimPerRun ?? 5;
      for(let count=0;count<limit && !controller.signal.aborted;count++) {
        // Claim immediately before execution, so aborting the current run does
        // not strand never-launched jobs in a misleading running state.
        const jobs = this.store.claimDue(this.now(), 1);
        if (jobs.length === 0) break;
        for (const job of jobs) {
          if (controller.signal.aborted) break;
          let result;
          try {result = await this.execute(job, controller.signal);}
          catch(error){this.store.markLaunchUnknown(job.projectId,this.now(),error instanceof Error?error.message:String(error),job.claimToken!);continue;}
          const now = this.now();
          if (result.ok) {
            this.store.markSucceeded(job.projectId, now,job.claimToken!);
          } else if(controller.signal.aborted || result.launchOutcome==='unknown') {
            this.store.markLaunchUnknown(job.projectId,now,result.error,job.claimToken!);
          } else {
            this.store.markFailed(job.projectId, now, result.error,job.claimToken!);
          }
        }
      }
    } catch(error) {
      this.queueError=error instanceof Error?error.message:String(error);this.options.onError?.(error);
    } finally {
      this.running = false;
      this.activeController = null;
      token?.release();
      settleRun();
      this.activeRun = null;
      if (!this.stopped && !this.queueError) {
        const now = this.now();
        const nextDueAt = this.store.nextDueAt(now);
        if (nextDueAt !== null) {
          this.kick(Math.max(0, nextDueAt - now));
        }
      }
    }
  }

  private kick(delayMs = 0): void {
    if (this.stopped) return;
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

function isJob(value: unknown): value is KSwarmInitialPlanBootstrapJob & {schemaVersion?:number} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.projectId === 'string'
    && typeof record.projectName === 'string'
    && typeof record.goal === 'string'
    && typeof record.poAgent === 'string'
    && Array.isArray(record.members)
    && record.members.every(member=>typeof member==='string')
    && ['pending','running','succeeded','failed','launch_unknown','legacy_unverified'].includes(String(record.status))
    && Number.isSafeInteger(record.attempts) && Number(record.attempts)>=0
    && Number.isSafeInteger(record.maxAttempts) && Number(record.maxAttempts)>0
    && typeof record.createdAt==='number' && Number.isFinite(record.createdAt)
    && typeof record.updatedAt==='number' && Number.isFinite(record.updatedAt)
    && typeof record.nextAttemptAt==='number' && Number.isFinite(record.nextAttemptAt);
}

function isDue(job: KSwarmInitialPlanBootstrapJob, now: number): boolean {
  return job.status === 'pending' && job.nextAttemptAt <= now;
}
