import {createHash} from 'node:crypto';
import {canonicalVerificationJson as completionJson} from '../../src/runtime/verification/protocol.js';
import {freezeProjection} from './loop-business-projection.js';
import {consumeLoopTimedCompletion,type LoopTimedReceipt} from './loop-timed-completion.js';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  computeInitialDueAt,
  computeNextDueAt,
  countMissedIntervals,
  validateTrigger,
} from './timed-action-trigger.js';
import type {
  ClaimedTimedAction,
  CreateTimedActionInput,
  ExecutorRecoveryDecision,
  LoopTimedActionDecision,
  OverdueRecoveryContext,
  TimedActionExecutor,
  TimedActionExecutorKind,
  TimedActionPolicy,
  TimedActionRecord,
  TimedActionRecoveryReason,
  TimedActionRunRecord,
  TimedActionSource,
  TimedActionStatus,
  TimedActionTrigger,
} from './timed-action-types.js';

export interface TimedActionRow {
  id: string;
  title: string;
  description: string;
  trigger_kind: string;
  trigger_json: string;
  executor_kind: string;
  executor_json: string;
  policy_json: string;
  status: TimedActionStatus;
  source: TimedActionSource;
  owner_kind: TimedActionRecord['ownerKind'];
  owner_id: string;
  created_by_task_id: string | null;
  next_due_at: number | null;
  last_due_at: number | null;
  run_count: number;
  consecutive_failures: number;
  locked_run_id: string | null;
  locked_at: number | null;
  last_runtime_task_id: string | null;
  last_error: string | null;
  reviewed_at: number | null;
  user_approved_auto: number;
  created_at: number;
  updated_at: number;
}

export interface TimedActionRunRow {
  run_id: string;
  action_id: string;
  executor_kind: TimedActionExecutorKind;
  status: string;
  started_at: number;
  finished_at: number | null;
  runtime_task_id: string | null;
  error: string | null;
  decision_json: string | null;
}

interface AutomationStoreMetadataRow {
  value: number;
}

export interface ReleaseStaleLocksOptions {
  resolveLinkedLoopRun?: (input: {
    action: TimedActionRecord;
    actionId: string;
    timedActionRunId: string;
  }) => LoopTimedActionDecision | undefined;
}

export interface LoopTimedRows {action:TimedActionRow;run:TimedActionRunRow;version:{key:string;value:number}}
export interface LoopTimedTarget {action:TimedActionRecord;run:TimedActionRunRecord;rows:LoopTimedRows;vector:string;deleted:boolean}
const receiptHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const retainedLoopHistory="(exists(select 1 from loop_timed_completion_receipts c where c.timed_run_id=timed_action_runs.run_id) or (executor_kind='loop' and status in ('claimed','running','publication_pending')))";
export class TimedActionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec('pragma busy_timeout = 5000');
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  getAutomationStoreVersion(): number {
    const row = this.db.prepare(`
      select value from automation_store_metadata where key = 'version'
    `).get() as AutomationStoreMetadataRow | undefined;
    return row?.value ?? 0;
  }

  getLoopTimedTarget(actionId:string,runId:string):Readonly<LoopTimedTarget> {
    const action=this.db.prepare('SELECT * FROM timed_actions WHERE id=?').get(actionId) as unknown as TimedActionRow|undefined;
    const run=this.db.prepare('SELECT * FROM timed_action_runs WHERE run_id=?').get(runId) as unknown as TimedActionRunRow|undefined;
    const version=this.db.prepare("SELECT * FROM automation_store_metadata WHERE key='version'").get() as {key:string;value:number}|undefined;
    if(!action||!run||run.action_id!==actionId||!version||!Number.isSafeInteger(version.value)||version.value<0)throw Error('loop_timed_target');
    const deleted=!!this.db.prepare('SELECT action_id FROM loop_timed_action_tombstones WHERE action_id=?').get(actionId),rows={action,run,version};
    return freezeProjection(JSON.parse(JSON.stringify({action:this.rowToRecord(action),run:this.runRowToRecord(run),rows,deleted,vector:completionJson({rows,deleted})}))) as Readonly<LoopTimedTarget>;
  }

  getLoopTimedReceipt(runId:string):Readonly<LoopTimedReceipt>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_timed_completion_receipts WHERE timed_run_id=?').get(runId) as {timed_run_id:string;record_json:string;record_hash:string}|undefined;
    if(!row)return undefined;
    const v=JSON.parse(row.record_json) as LoopTimedReceipt;
    if(completionJson(v)!==row.record_json||receiptHash(row.record_json)!==row.record_hash||v.version!==1||v.timedRunId!==runId||!['committed','pending','rejected'].includes(v.disposition)||![1,2].includes(v.revision)||v.revision===2&&v.disposition!=='committed'||v.original.run.run_id!==runId||v.after.run.run_id!==runId||v.original.action.id!==v.actionId||v.after.action.id!==v.actionId||v.original.run.action_id!==v.actionId||v.after.run.action_id!==v.actionId||v.original.run.executor_kind!=='loop'||v.after.run.executor_kind!=='loop')throw Error('loop_timed_receipt_corrupt');
    const keys=['version','revision','actionId','timedRunId','loopId','loopRunId','mode','disposition','outcome','original','after','pendingAction','decision','loopIdentity'];
    const invalid=()=>{throw Error('loop_timed_receipt_corrupt');};
    if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||!['normal','reused','stale'].includes(v.mode)||!['success','publication_pending','failed','blocked','rejected'].includes(v.outcome))invalid();
    if(v.disposition!==(v.outcome==='publication_pending'?'pending':v.outcome==='rejected'?'rejected':'committed')||v.revision===2&&v.outcome!=='success'||(v.pendingAction!==null)!==(v.disposition==='pending'||v.revision===2))invalid();
    if(!v.loopId||typeof v.loopId!=='string'||v.loopRunId!==null&&typeof v.loopRunId!=='string'||v.loopIdentity!==null&&typeof v.loopIdentity!=='string')invalid();
    if(v.outcome==='rejected'){if(v.decision!==null)invalid();}
    else if(!v.loopRunId||!v.decision||v.decision.loopRunId!==v.loopRunId||v.decision.loopStatus!==v.outcome||!!v.decision.reused!==(v.mode==='reused'))invalid();
    if(v.after.run.status!==(v.outcome==='rejected'?'cancelled':v.outcome==='blocked'?'pause':v.outcome==='failed'?(v.mode==='stale'?'failed_stale':'failed'):v.outcome==='success'&&v.mode==='reused'&&v.revision===1?'skip':v.outcome))invalid();
    if(v.original.version.key!=='version'||v.after.version.key!=='version'||!Number.isSafeInteger(v.original.version.value)||!Number.isSafeInteger(v.after.version.value)||v.original.version.value<0||v.after.version.value<=v.original.version.value||v.revision===1&&v.after.version.value!==v.original.version.value+1)invalid();
    const current=this.db.prepare('SELECT * FROM timed_action_runs WHERE run_id=?').get(runId);
    if(completionJson(current)!==completionJson(v.after.run))throw Error('loop_timed_receipt_history_changed');
    return freezeProjection(v);
  }

  listLoopTimedReconciliation():{actionId:string;timedRunId:string}[]{
    return (this.db.prepare("SELECT r.action_id,r.run_id FROM timed_action_runs r LEFT JOIN loop_timed_completion_receipts c ON c.timed_run_id=r.run_id WHERE r.executor_kind='loop' AND (r.status IN ('claimed','running','publication_pending')) ORDER BY r.started_at,r.run_id").all() as {action_id:string;run_id:string}[]).map(r=>({actionId:r.action_id,timedRunId:r.run_id}));
  }

  applyLoopTimedCompletion(ticket:object):Readonly<LoopTimedReceipt> {
    const entry=consumeLoopTimedCompletion(this,ticket);
    return this.transaction(()=>{
      const before=this.getLoopTimedTarget(entry.target.action.id,entry.target.run.runId);
      if(before.vector!==entry.target.vector||completionJson(this.getLoopTimedReceipt(before.run.runId)??null)!==completionJson(entry.previous??null))throw Error('loop_timed_changed');
      if(!Number.isSafeInteger(entry.now)||entry.now<Math.max(before.rows.action.updated_at,before.rows.run.started_at)||before.rows.version.value>=Number.MAX_SAFE_INTEGER)throw Error('loop_timed_time');
      const checkLoop=entry.consume(),after=JSON.parse(completionJson(before.rows)) as LoopTimedRows,a=after.action,r=after.run,current=before.action;
      const decision=entry.decision?{...entry.decision,...(entry.mode==='stale'?{recoveryReason:'stale_lock'}:{}),...(entry.outcome==='blocked'?{recoveryDecision:{action:'pause',reason:'blocked_requires_user_action'}}:{})}:null;
      if(entry.previous){
        if(entry.previous.disposition!=='pending'||entry.outcome!=='success')throw Error('loop_timed_transition');
        if(entry.previous.pendingAction&&completionJson(a)===completionJson(entry.previous.pendingAction)&&current.trigger.kind==='once'){a.status='completed';a.updated_at=entry.now;}
      }else if(entry.outcome==='rejected'){
        // Only release the obsolete occurrence's own lock, never a new one.
        if(a.locked_run_id===r.run_id){a.locked_run_id=null;a.locked_at=null;a.updated_at=entry.now;}
      }else if(entry.outcome==='success'&&entry.mode==='reused'){
        a.next_due_at=computeNextDueAt(current.trigger,entry.now)??null;a.locked_run_id=null;a.locked_at=null;a.last_error='logical_run_already_completed: '+entry.loopRunId;a.updated_at=entry.now;
      }else if(entry.outcome==='success'||entry.outcome==='publication_pending'){
        const count=current.runCount+1,limit=current.policy.maxRuns!==undefined&&count>=current.policy.maxRuns||current.policy.expiresAt!==undefined&&current.policy.expiresAt<=entry.now;
        a.status=current.trigger.kind==='once'?(entry.outcome==='success'?'completed':'paused'):limit?'paused':'active';a.next_due_at=a.status==='active'?computeNextDueAt(current.trigger,entry.now)??null:null;
        a.last_due_at=entry.now;a.run_count=count;a.locked_run_id=null;a.locked_at=null;a.updated_at=entry.now;
        if(entry.outcome==='success'){a.consecutive_failures=0;a.last_error=null;}
      }else if(entry.outcome==='blocked'){
        a.status='paused';a.next_due_at=null;a.locked_run_id=null;a.locked_at=null;a.last_error='blocked_requires_user_action';a.updated_at=entry.now;
      }else{
        const failures=current.consecutiveFailures+1,pause=current.policy.maxConsecutiveFailures!==undefined&&failures>=current.policy.maxConsecutiveFailures;
        a.status=pause?'paused':'active';a.next_due_at=pause?null:this.nextRetryDueAt(current.trigger,entry.now)??null;a.consecutive_failures=failures;a.locked_run_id=null;a.locked_at=null;a.last_error=entry.decision?.nextActionSummary??'loop failed';a.updated_at=entry.now;
      }
      r.status=entry.outcome==='rejected'?'cancelled':entry.outcome==='blocked'?'pause':entry.outcome==='failed'?(entry.mode==='stale'?'failed_stale':'failed'):entry.outcome==='success'&&entry.mode==='reused'&&!entry.previous?'skip':entry.outcome;
      r.finished_at=entry.now;r.error=entry.outcome==='rejected'?'loop_completion_superseded':entry.outcome==='blocked'?'blocked_requires_user_action':entry.outcome==='failed'?entry.decision?.nextActionSummary??'loop failed':null;r.decision_json=completionJson(decision??{reason:'loop_completion_superseded'});after.version.value++;
      const receipt:LoopTimedReceipt={version:1,revision:entry.previous?2:1,actionId:a.id,timedRunId:r.run_id,loopId:entry.loopId,loopRunId:entry.loopRunId,mode:entry.mode,disposition:entry.outcome==='publication_pending'?'pending':entry.outcome==='rejected'?'rejected':'committed',outcome:entry.outcome,original:entry.previous?.original??before.rows,after,pendingAction:entry.previous?.pendingAction??(entry.outcome==='publication_pending'?a:null),decision:entry.decision,loopIdentity:entry.previous?.loopIdentity??entry.loopIdentity};
      const actionWrite=this.db.prepare('UPDATE timed_actions SET status=?,next_due_at=?,last_due_at=?,run_count=?,consecutive_failures=?,locked_run_id=?,locked_at=?,last_error=?,updated_at=? WHERE id=?').run(a.status,a.next_due_at,a.last_due_at,a.run_count,a.consecutive_failures,a.locked_run_id,a.locked_at,a.last_error,a.updated_at,a.id);
      const runWrite=this.db.prepare('UPDATE timed_action_runs SET status=?,finished_at=?,error=?,decision_json=? WHERE run_id=? AND action_id=?').run(r.status,r.finished_at,r.error,r.decision_json,r.run_id,r.action_id);
      const encoded=completionJson(receipt);this.db.prepare('INSERT INTO loop_timed_completion_receipts(timed_run_id,record_json,record_hash) VALUES(?,?,?) ON CONFLICT(timed_run_id) DO UPDATE SET record_json=excluded.record_json,record_hash=excluded.record_hash').run(r.run_id,encoded,receiptHash(encoded));this.bumpAutomationStoreVersion();
      checkLoop();
      if(actionWrite.changes!==1||runWrite.changes!==1||this.getLoopTimedTarget(a.id,r.run_id).vector!==completionJson({rows:after,deleted:before.deleted})||completionJson(this.getLoopTimedReceipt(r.run_id))!==encoded)throw Error('loop_timed_commit_changed');
      return freezeProjection(receipt);
    });
  }

  createAction(input: CreateTimedActionInput): TimedActionRecord {
    const now = input.now ?? Date.now();
    const policy = input.policy ?? {};
    validateTrigger(input.trigger, policy.minIntervalMinutes);
    const id = input.id ?? randomUUID();
    const nextDueAt = input.nextDueAt ?? computeInitialDueAt(input.trigger, now);
    const record: TimedActionRecord = {
      id,
      title: input.title,
      description: input.description ?? '',
      trigger: input.trigger,
      executor: input.executor,
      policy,
      status: input.status ?? 'active',
      source: input.source,
      ownerKind: input.ownerKind ?? defaultOwnerKind(input.source),
      ownerId: input.ownerId ?? defaultOwnerId(input),
      createdByTaskId: input.createdByTaskId,
      nextDueAt,
      lastDueAt: input.lastDueAt,
      runCount: input.runCount ?? 0,
      consecutiveFailures: input.consecutiveFailures ?? 0,
      lastRuntimeTaskId: input.lastRuntimeTaskId,
      // SQLite column default is 0 (for historical rows); most new tasks default to auto-execute.
      userApprovedAuto: input.userApprovedAuto ?? true,
      createdAt: now,
      updatedAt: now,
    };

    return this.transaction(() => {
      this.db.prepare(`
        insert into timed_actions (
          id, title, description, trigger_kind, trigger_json, executor_kind, executor_json, policy_json,
          status, source, owner_kind, owner_id, created_by_task_id, next_due_at, last_due_at, run_count,
          consecutive_failures, locked_run_id, locked_at, last_runtime_task_id, last_error,
          user_approved_auto, created_at, updated_at
        ) values (
          @id, @title, @description, @triggerKind, @triggerJson, @executorKind, @executorJson, @policyJson,
          @status, @source, @ownerKind, @ownerId, @createdByTaskId, @nextDueAt, @lastDueAt, @runCount,
          @consecutiveFailures, null, null, @lastRuntimeTaskId, null,
          @userApprovedAuto, @createdAt, @updatedAt
        )
      `).run({
        id: record.id,
        title: record.title,
        description: record.description ?? '',
        triggerKind: record.trigger.kind,
        triggerJson: JSON.stringify(record.trigger),
        executorKind: record.executor.kind,
        executorJson: JSON.stringify(record.executor),
        policyJson: JSON.stringify(record.policy),
        status: record.status,
        source: record.source,
        ownerKind: record.ownerKind,
        ownerId: record.ownerId,
        createdByTaskId: record.createdByTaskId ?? null,
        nextDueAt: record.nextDueAt ?? null,
        lastDueAt: record.lastDueAt ?? null,
        runCount: record.runCount,
        consecutiveFailures: record.consecutiveFailures,
        lastRuntimeTaskId: record.lastRuntimeTaskId ?? null,
        userApprovedAuto: record.userApprovedAuto ? 1 : 0,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      this.bumpAutomationStoreVersion();
      return record;
    });
  }

  updateActionDefinition(
    id: string,
    input: {
      title: string;
      description?: string;
      trigger: TimedActionTrigger;
      executor: TimedActionExecutor;
      policy?: TimedActionPolicy;
      nextDueAt?: number;
      now?: number;
    }
  ): TimedActionRecord | undefined {
    const current = this.getAction(id);
    if (!current) return undefined;

    const now = input.now ?? Date.now();
    const policy = input.policy ?? current.policy;
    validateTrigger(input.trigger, policy.minIntervalMinutes);
    const nextDueAt = input.nextDueAt ?? computeInitialDueAt(input.trigger, now);
    return this.transaction(() => {
      const result = this.db.prepare(`
        update timed_actions
        set title = ?, description = ?, trigger_kind = ?, trigger_json = ?,
            executor_kind = ?, executor_json = ?, policy_json = ?, next_due_at = ?,
            updated_at = ?
        where id = ?
      `).run(
        input.title,
        input.description ?? '',
        input.trigger.kind,
        JSON.stringify(input.trigger),
        input.executor.kind,
        JSON.stringify(input.executor),
        JSON.stringify(policy),
        nextDueAt ?? null,
        now,
        id
      );
      if (result.changes !== 1) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getAction(id);
    });
  }

  getAction(id: string): TimedActionRecord | undefined {
    if(this.db.prepare('SELECT action_id FROM loop_timed_action_tombstones WHERE action_id=?').get(id))return undefined;
    const row = this.db.prepare('select * from timed_actions where id = ?').get(id) as TimedActionRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  listActions(filter: { executorKind?: TimedActionExecutorKind; executorKinds?: TimedActionExecutorKind[]; includeInactive?: boolean } = {}): TimedActionRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.executorKinds && filter.executorKinds.length > 0) {
      clauses.push(`executor_kind in (${filter.executorKinds.map(() => '?').join(', ')})`);
      params.push(...filter.executorKinds);
    } else if (filter.executorKind) {
      clauses.push('executor_kind = ?');
      params.push(filter.executorKind);
    }
    if (!filter.includeInactive) {
      clauses.push("status in ('active', 'paused')");
    }
    const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
    const rows = typedRows<TimedActionRow>(
      this.db.prepare(`select * from timed_actions${where} order by next_due_at is null, next_due_at asc, created_at desc`).all(...params)
    );
    return rows.filter(row=>!this.db.prepare('SELECT action_id FROM loop_timed_action_tombstones WHERE action_id=?').get(row.id)).map(row => this.rowToRecord(row));
  }

  claimDueActions(
    now: number,
    limit: number,
    options: {
      executorKinds?: TimedActionExecutorKind[];
      recoveryReason?: TimedActionRecoveryReason;
    } = {}
  ): ClaimedTimedAction[] {
    return this.transaction(() => {
      const clauses = [
        "status = 'active'",
        'next_due_at is not null',
        'next_due_at <= ?',
        'locked_run_id is null',
      ];
      const params: SQLInputValue[] = [now];
      if (options.executorKinds && options.executorKinds.length > 0) {
        clauses.push(`executor_kind in (${options.executorKinds.map(() => '?').join(', ')})`);
        params.push(...options.executorKinds);
      }
      params.push(Math.max(0, limit));

      const rows = typedRows<TimedActionRow>(this.db.prepare(`
        select * from timed_actions
        where ${clauses.join(' and ')}
        order by case executor_kind when 'notify' then 0 else 1 end, next_due_at asc
        limit ?
      `).all(...params));

      const claimed: ClaimedTimedAction[] = [];
      for (const row of rows) {
        const runId = randomUUID();
        const update = this.db.prepare(`
          update timed_actions
          set locked_run_id = ?, locked_at = ?, updated_at = ?
          where id = ? and locked_run_id is null and status = 'active'
        `).run(runId, now, now, row.id);
        if (update.changes !== 1) continue;

        const action = this.rowToRecord({ ...row, locked_run_id: runId, locked_at: now, updated_at: now });
        const context: OverdueRecoveryContext = {
          scheduledDueAt: row.next_due_at ?? now,
          claimedAt: now,
          overdueMs: Math.max(0, now - (row.next_due_at ?? now)),
          missedIntervals: countMissedIntervals(action.trigger, row.next_due_at ?? now, now),
          recoveryReason: options.recoveryReason ?? 'normal_tick',
        };
        this.db.prepare(`
          insert into timed_action_runs (
            run_id, action_id, executor_kind, status, started_at, finished_at,
            runtime_task_id, error, decision_json
          ) values (?, ?, ?, 'claimed', ?, null, null, null, ?)
        `).run(runId, row.id, row.executor_kind, now, JSON.stringify({ context, originalAction: action }));
        claimed.push({ action, runId, context });
      }
      if (claimed.length > 0) {
        this.bumpAutomationStoreVersion();
      }
      return claimed;
    });
  }

  markRunRunning(actionId: string, runId: string, now: number): void {
    if(this.getLoopTimedReceipt(runId))throw Error('loop_timed_receipt_terminal');
    this.transaction(() => {
      const result = this.db.prepare(`
        update timed_action_runs
        set status = 'running', started_at = ?
        where action_id = ? and run_id = ?
      `).run(now, actionId, runId);
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
    });
  }

  finishRunSuccess(actionId: string, runId: string, now: number, result: { runtimeTaskId?: string; decision?: Record<string, unknown> }): void {
    if((this.db.prepare('SELECT executor_kind FROM timed_action_runs WHERE run_id=?').get(runId) as {executor_kind:string}|undefined)?.executor_kind==='loop')throw Error('loop_timed_ticket_required');
    this.transaction(() => {
      const current = this.getAction(actionId);
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        if (this.updateRun(runId, 'success', now, result.runtimeTaskId, undefined, result.decision)) {
          this.bumpAutomationStoreVersion();
        }
        return;
      }

      const runCount = current.runCount + 1;
      const maxRunsReached = current.policy.maxRuns !== undefined && runCount >= current.policy.maxRuns;
      const expired = current.policy.expiresAt !== undefined && current.policy.expiresAt <= now;
      const status: TimedActionStatus =
        current.trigger.kind === 'once' ? 'completed' :
          maxRunsReached || expired ? 'paused' :
            'active';
      const nextDueAt = status === 'active' ? computeNextDueAt(current.trigger, now) : undefined;
      const actionUpdate = this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, last_due_at = ?, run_count = ?,
            consecutive_failures = 0, locked_run_id = null, locked_at = null,
            last_runtime_task_id = ?, last_error = null, updated_at = ?
        where id = ?
      `).run(status, nextDueAt ?? null, now, runCount, result.runtimeTaskId ?? current.lastRuntimeTaskId ?? null, now, actionId);
      const runUpdated = this.updateRun(runId, 'success', now, result.runtimeTaskId, undefined, result.decision);
      if (actionUpdate.changes > 0 || runUpdated) {
        this.bumpAutomationStoreVersion();
      }
    });
  }

  finishRunPublicationPending(_actionId:string,_runId:string,_now:number,_decision:LoopTimedActionDecision):void {throw Error('loop_timed_ticket_required');}

  private finishLoopPending(current:TimedActionRecord,runId:string,now:number,decision:LoopTimedActionDecision):void {
    if(current.lockedRunId===runId&&current.status==='active'){
      const runCount=current.runCount+1;
      const pause=current.trigger.kind==='once'||current.policy.maxRuns!==undefined&&runCount>=current.policy.maxRuns||current.policy.expiresAt!==undefined&&current.policy.expiresAt<=now;
      this.db.prepare(`UPDATE timed_actions SET status=?,next_due_at=?,last_due_at=?,run_count=?,locked_run_id=null,locked_at=null,updated_at=? WHERE id=?`).run(pause?'paused':'active',pause?null:computeNextDueAt(current.trigger,now),now,runCount,now,current.id);
    }
    this.updateRun(runId,'publication_pending',now,undefined,undefined,decision);
  }

  finishRunFailure(actionId: string, runId: string, now: number, error: string): void {
    if(this.getLoopTimedReceipt(runId))return;
    this.transaction(() => {
      const current = this.getAction(actionId);
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        if (this.updateRun(runId, 'failed', now, undefined, error)) {
          this.bumpAutomationStoreVersion();
        }
        return;
      }

      const consecutiveFailures = current.consecutiveFailures + 1;
      const shouldPause = current.policy.maxConsecutiveFailures !== undefined && consecutiveFailures >= current.policy.maxConsecutiveFailures;
      const nextDueAt = shouldPause ? undefined : this.nextRetryDueAt(current.trigger, now);
      const actionUpdate = this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, consecutive_failures = ?, locked_run_id = null,
            locked_at = null, last_error = ?, updated_at = ?
        where id = ?
      `).run(shouldPause ? 'paused' : 'active', nextDueAt ?? null, consecutiveFailures, error, now, actionId);
      const runUpdated = this.updateRun(runId, 'failed', now, undefined, error);
      if (actionUpdate.changes > 0 || runUpdated) {
        this.bumpAutomationStoreVersion();
      }
      if (shouldPause) {
        // Without this, an auto-paused task silently looks "still scheduled" —
        // a broken scheduled task then stalls unnoticed for weeks.
        console.warn(`[timed-action] auto-paused ${actionId} after ${consecutiveFailures} consecutive failures: ${error}`);
      }
    });
  }

  finishRunSkipped(
    actionId: string,
    runId: string,
    now: number,
    decision: Exclude<ExecutorRecoveryDecision, { action: 'execute' }>,
    completionDecision?: Record<string, unknown>
  ): void {
    if(this.getLoopTimedReceipt(runId))return;
    if(completionDecision?.loopStatus!==undefined||decision.reason.startsWith('logical_run_already_completed:'))throw Error('loop_timed_ticket_required');
    this.transaction(() => {
      const current = this.getAction(actionId);
      const runDecision = { recoveryDecision: decision, ...(completionDecision ?? {}) };
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        if (this.updateRun(runId, decision.action, now, undefined, decision.reason, runDecision)) {
          this.bumpAutomationStoreVersion();
        }
        return;
      }

      const status: TimedActionStatus =
        decision.action === 'complete' ? 'completed' :
          decision.action === 'pause' ? 'paused' :
            'active';
      const nextDueAt = decision.action === 'skip'
        ? decision.nextDueAt ?? computeNextDueAt(current.trigger, now)
        : undefined;
      const actionUpdate = this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, locked_run_id = null, locked_at = null,
            last_error = ?, updated_at = ?
        where id = ?
      `).run(status, nextDueAt ?? null, decision.reason, now, actionId);
      const runUpdated = this.updateRun(runId, decision.action, now, undefined, decision.reason, runDecision);
      if (actionUpdate.changes > 0 || runUpdated) {
        this.bumpAutomationStoreVersion();
      }
      if (decision.action === 'pause') {
        console.warn(`[timed-action] paused ${actionId}: ${decision.reason}`);
      }
    });
  }

  cancelAction(id: string, reason?: string, now = Date.now()): boolean {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update timed_actions
        set status = 'cancelled', next_due_at = null, locked_run_id = null, locked_at = null,
            last_error = coalesce(?, last_error), updated_at = ?
        where id = ? and status in ('active', 'paused')
      `).run(reason ?? null, now, id);
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
      return result.changes === 1;
    });
  }

  setActionStatus(
    id: string,
    status: Extract<TimedActionStatus, 'active' | 'paused'>,
    now = Date.now(),
    reason?: string
  ): TimedActionRecord | undefined {
    const current = this.getAction(id);
    if (!current || (current.status !== 'active' && current.status !== 'paused')) return undefined;
    const nextDueAt = status === 'active' ? computeInitialDueAt(current.trigger, now) : undefined;
    const lastError = status === 'paused' ? reason ?? 'paused_by_user' : undefined;
    return this.transaction(() => {
      const result = this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, locked_run_id = null, locked_at = null,
            last_error = ?, updated_at = ?
        where id = ? and status in ('active', 'paused')
      `).run(status, nextDueAt ?? null, lastError ?? null, now, id);
      if (result.changes !== 1) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getAction(id);
    });
  }

  deleteAction(id: string): boolean {
    return this.transaction(() => {
      if(this.db.prepare(`SELECT run_id FROM timed_action_runs WHERE action_id=? AND ${retainedLoopHistory} LIMIT 1`).get(id)){
        const exists=this.db.prepare('SELECT action_id FROM loop_timed_action_tombstones WHERE action_id=?').get(id);if(exists)return false;
        const timestamp=Date.now();this.db.prepare('INSERT INTO loop_timed_action_tombstones(action_id,deleted_at) VALUES(?,?)').run(id,timestamp);
        this.db.prepare("UPDATE timed_actions SET status='cancelled',locked_run_id=NULL,locked_at=NULL,next_due_at=NULL,updated_at=? WHERE id=?").run(timestamp,id);this.bumpAutomationStoreVersion();return true;
      }
      const runDelete = this.db.prepare('delete from timed_action_runs where action_id = ?').run(id);
      const result = this.db.prepare('delete from timed_actions where id = ?').run(id);
      if (result.changes === 1 || runDelete.changes > 0) {
        this.bumpAutomationStoreVersion();
      }
      return result.changes === 1;
    });
  }

  clearActionRunHistory(actionId: string, statuses?: string[]): number {
    return this.transaction(() => {
      let removed = 0;
      if (statuses && statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        const result = this.db
          .prepare(`delete from timed_action_runs where action_id = ? and status in (${placeholders}) AND NOT ${retainedLoopHistory}`)
          .run(actionId, ...statuses);
        removed = Number(result.changes ?? 0);
      } else {
        const result = this.db.prepare(`delete from timed_action_runs where action_id = ? AND NOT ${retainedLoopHistory}`).run(actionId);
        removed = Number(result.changes ?? 0);
      }
      if (removed > 0) this.bumpAutomationStoreVersion();
      return removed;
    });
  }

  releaseStaleLocks(now: number, staleAfterMs: number, options: ReleaseStaleLocksOptions = {}): number {
    if(options.resolveLinkedLoopRun)throw Error('loop_timed_ticket_required');
    return this.transaction(() => {
      const rows = typedRows<TimedActionRow>(this.db.prepare(`
        select * from timed_actions
        where locked_run_id is not null and locked_at <= ? and status = 'active' and executor_kind != 'loop'
      `).all(now - staleAfterMs));

      for (const row of rows) {
        const action = this.rowToRecord(row);
        const linkedLoopDecision = row.locked_run_id && action.executor.kind === 'loop'
          ? options.resolveLinkedLoopRun?.({
            action,
            actionId: action.id,
            timedActionRunId: row.locked_run_id,
          })
          : undefined;
        if (linkedLoopDecision) {
          this.finishStaleLockFromLoopDecision(action, row.locked_run_id!, now, linkedLoopDecision);
          continue;
        }
        const failures = action.consecutiveFailures + 1;
        const shouldPause = action.policy.maxConsecutiveFailures !== undefined && failures >= action.policy.maxConsecutiveFailures;
        this.updateRun(row.locked_run_id!, 'failed_stale', now, undefined, 'executor stale lock', { recoveryReason: 'stale_lock' });
        this.db.prepare(`
          update timed_actions
          set status = ?, locked_run_id = null, locked_at = null, consecutive_failures = ?,
              next_due_at = ?, last_error = 'executor stale lock', updated_at = ?
          where id = ?
        `).run(shouldPause ? 'paused' : 'active', failures, shouldPause ? null : now, now, row.id);
      }
      if (rows.length > 0) {
        this.bumpAutomationStoreVersion();
      }
      return rows.length;
    });
  }

  listRuns(actionId: string): TimedActionRunRecord[] {
    const rows = typedRows<TimedActionRunRow>(this.db.prepare(`
      select * from timed_action_runs where action_id = ? order by started_at desc
    `).all(actionId));
    return rows.map(row => this.runRowToRecord(row));
  }

  private applySchema(): void {
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(`
      create table if not exists timed_actions (
        id text primary key,
        title text not null,
        description text not null default '',
        trigger_kind text not null,
        trigger_json text not null,
        executor_kind text not null,
        executor_json text not null,
        policy_json text not null,
        status text not null,
        source text not null,
        owner_kind text not null default 'migration',
        owner_id text not null default 'legacy-migration',
        created_by_task_id text,
        next_due_at integer,
        last_due_at integer,
        run_count integer not null default 0,
        consecutive_failures integer not null default 0,
        locked_run_id text,
        locked_at integer,
        last_runtime_task_id text,
        last_error text,
        created_at integer not null,
        updated_at integer not null
      );

      create index if not exists idx_timed_actions_due
      on timed_actions(status, next_due_at);

      create table if not exists timed_action_runs (
        run_id text primary key,
        action_id text not null,
        executor_kind text not null,
        status text not null,
        started_at integer not null,
        finished_at integer,
        runtime_task_id text,
        error text,
        decision_json text,
        foreign key(action_id) references timed_actions(id)
      );

      create table if not exists automation_store_metadata (
        key text primary key,
        value integer not null
      );
    `);
    this.ensureTimedActionDescriptionColumn();
    this.ensureTimedActionReviewColumns();
    this.ensureTimedActionOwnershipColumns();
    this.db.exec(`CREATE TABLE IF NOT EXISTS loop_timed_completion_receipts(timed_run_id TEXT PRIMARY KEY REFERENCES timed_action_runs(run_id) ON DELETE RESTRICT,record_json TEXT NOT NULL,record_hash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS loop_timed_action_tombstones(action_id TEXT PRIMARY KEY REFERENCES timed_actions(id) ON DELETE RESTRICT,deleted_at INTEGER NOT NULL);`);

  }

  private ensureTimedActionDescriptionColumn(): void {
    const columns = typedRows<{ name: string }>(this.db.prepare('pragma table_info(timed_actions)').all());
    if (!columns.some(column => column.name === 'description')) {
      this.db.exec("alter table timed_actions add column description text not null default ''");
    }
  }

  private ensureTimedActionReviewColumns(): void {
    const columns = typedRows<{ name: string }>(this.db.prepare('pragma table_info(timed_actions)').all());
    if (!columns.some(column => column.name === 'reviewed_at')) {
      this.db.exec('alter table timed_actions add column reviewed_at integer');
    }
    if (!columns.some(column => column.name === 'user_approved_auto')) {
      this.db.exec('alter table timed_actions add column user_approved_auto integer not null default 0');
    }
  }

  private ensureTimedActionOwnershipColumns(): void {
    const columns = typedRows<{ name: string }>(this.db.prepare('pragma table_info(timed_actions)').all());
    if (!columns.some(column => column.name === 'owner_kind')) this.db.exec("alter table timed_actions add column owner_kind text not null default 'migration'");
    if (!columns.some(column => column.name === 'owner_id')) this.db.exec("alter table timed_actions add column owner_id text not null default 'legacy-migration'");
    this.db.exec(`update timed_actions set owner_kind = case source when 'user' then 'user' when 'agent' then 'agent_task' else 'migration' end where owner_kind = 'migration' and source in ('user', 'agent')`);
    this.db.exec(`create index if not exists idx_timed_actions_owner on timed_actions(owner_kind, owner_id)`);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try {
        this.db.exec('rollback');
      } catch { /* ignore rollback errors */ }
      throw error;
    }
  }

  private bumpAutomationStoreVersion(): void {
    this.db.prepare(`
      insert into automation_store_metadata(key, value)
      values ('version', 1)
      on conflict(key) do update set value = value + 1
    `).run();
  }

  private nextRetryDueAt(trigger: TimedActionTrigger, now: number): number {
    if (trigger.kind === 'once') return now + 60_000;
    return computeNextDueAt(trigger, now);
  }

  private finishStaleLockFromLoopDecision(
    current: TimedActionRecord,
    runId: string,
    now: number,
    loopDecision: LoopTimedActionDecision
  ): void {
    const decision = { recoveryReason: 'stale_lock', ...loopDecision };
    if(loopDecision.loopStatus==='publication_pending'){this.finishLoopPending(current,runId,now,decision);return;}
    if (loopDecision.loopStatus === 'success') {
      const runCount = current.runCount + 1;
      const maxRunsReached = current.policy.maxRuns !== undefined && runCount >= current.policy.maxRuns;
      const expired = current.policy.expiresAt !== undefined && current.policy.expiresAt <= now;
      const status: TimedActionStatus =
        current.trigger.kind === 'once' ? 'completed' :
          maxRunsReached || expired ? 'paused' :
            'active';
      const nextDueAt = status === 'active' ? computeNextDueAt(current.trigger, now) : undefined;
      this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, last_due_at = ?, run_count = ?,
            consecutive_failures = 0, locked_run_id = null, locked_at = null,
            last_error = null, updated_at = ?
        where id = ?
      `).run(status, nextDueAt ?? null, now, runCount, now, current.id);
      this.updateRun(runId, 'success', now, undefined, undefined, decision);
      return;
    }

    if (loopDecision.loopStatus === 'blocked') {
      const reason = 'blocked_requires_user_action';
      this.db.prepare(`
        update timed_actions
        set status = 'paused', next_due_at = null, locked_run_id = null,
            locked_at = null, last_error = ?, updated_at = ?
        where id = ?
      `).run(reason, now, current.id);
      this.updateRun(runId, 'pause', now, undefined, reason, decision);
      return;
    }

    const error = loopDecision.nextActionSummary ?? `loop failed: ${loopDecision.loopRunId}`;
    const failures = current.consecutiveFailures + 1;
    const shouldPause = current.policy.maxConsecutiveFailures !== undefined && failures >= current.policy.maxConsecutiveFailures;
    const nextDueAt = shouldPause ? undefined : this.nextRetryDueAt(current.trigger, now);
    this.db.prepare(`
      update timed_actions
      set status = ?, next_due_at = ?, consecutive_failures = ?, locked_run_id = null,
          locked_at = null, last_error = ?, updated_at = ?
      where id = ?
    `).run(shouldPause ? 'paused' : 'active', nextDueAt ?? null, failures, error, now, current.id);
    this.updateRun(runId, 'failed_stale', now, undefined, error, decision);
  }

  private updateRun(
    runId: string,
    status: string,
    finishedAt: number,
    runtimeTaskId?: string,
    error?: string,
    decision?: Record<string, unknown>
  ): boolean {
    const result = this.db.prepare(`
      update timed_action_runs
      set status = ?, finished_at = ?, runtime_task_id = coalesce(?, runtime_task_id),
          error = ?, decision_json = coalesce(?, decision_json)
      where run_id = ?
    `).run(status, finishedAt, runtimeTaskId ?? null, error ?? null, decision ? JSON.stringify(decision) : null, runId);
    return result.changes === 1;
  }

  approveAuto(id: string, now: number = Date.now()): TimedActionRecord | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update timed_actions
        set reviewed_at = ?, user_approved_auto = 1, updated_at = ?
        where id = ?
      `).run(now, now, id);
      if (result.changes === 0) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getAction(id);
    });
  }

  revokeAuto(id: string, now: number = Date.now()): TimedActionRecord | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update timed_actions
        set user_approved_auto = 0, updated_at = ?
        where id = ?
      `).run(now, id);
      if (result.changes === 0) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getAction(id);
    });
  }

  private rowToRecord(row: TimedActionRow): TimedActionRecord {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      trigger: parseJson<TimedActionTrigger>(row.trigger_json),
      executor: parseJson<TimedActionExecutor>(row.executor_json),
      policy: parseJson<TimedActionPolicy>(row.policy_json),
      status: row.status,
      source: row.source,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      createdByTaskId: row.created_by_task_id ?? undefined,
      nextDueAt: row.next_due_at ?? undefined,
      lastDueAt: row.last_due_at ?? undefined,
      runCount: row.run_count,
      consecutiveFailures: row.consecutive_failures,
      lockedRunId: row.locked_run_id ?? undefined,
      lockedAt: row.locked_at ?? undefined,
      lastRuntimeTaskId: row.last_runtime_task_id ?? undefined,
      lastError: row.last_error ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      userApprovedAuto: row.user_approved_auto === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private runRowToRecord(row: TimedActionRunRow): TimedActionRunRecord {
    return {
      runId: row.run_id,
      actionId: row.action_id,
      executorKind: row.executor_kind,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      runtimeTaskId: row.runtime_task_id ?? undefined,
      error: row.error ?? undefined,
      decision: row.decision_json ? parseJson<Record<string, unknown>>(row.decision_json) : undefined,
    };
  }
}

function defaultOwnerKind(source: TimedActionSource): TimedActionRecord['ownerKind'] {
  if (source === 'user') return 'user';
  if (source === 'agent') return 'agent_task';
  return 'migration';
}

function defaultOwnerId(input: CreateTimedActionInput): string {
  if (input.source === 'user') return 'desktop-user';
  if (input.source === 'agent') return input.createdByTaskId ?? 'legacy-agent-task';
  return 'legacy-migration';
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}
