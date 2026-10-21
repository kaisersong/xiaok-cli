import {createLoopDatabaseOwnerGroup} from './loop-database-owner.js';
import {readLoopCompletedRun} from './loop-completion-consumer.js';
import {captureLoopRunContext,assertOrdinaryLoopOwner,type LoopRunContext} from './loop-run-context.js';
import { join } from 'node:path';
import {
  ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
  ArtifactEvidenceRegressionScanner,
} from './artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
import { createLoopFinalizer, type LoopFinalizer } from './loop-finalizer.js';
import {
  KSWARM_SERVICE_HEALTH_LOOP_ID,
  KSwarmServiceHealthScanner,
} from './kswarm-health-loop.js';
import { LoopStore } from './loop-store.js';
import type {
  LoopRun,
  LoopRunTrigger,
} from './loop-types.js';
import type { LearnedConstraint } from './loop-types.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { createUserLoopTemplateRunner, type UserLoopTaskPort, type UserLoopTemplateRunner } from './user-loop-template-runner.js';
import type {
  CompletionOwnerKind,
} from './completion-evidence-types.js';
import type { KSwarmHealthDiagnosticInput } from './kswarm-service-diagnostics.js';
import type {
  LoopTimedActionDecision,
  OverdueRecoveryContext,
  TimedActionExecutorHandler,
  TimedActionExecutorRuntimeContext,
  TimedActionRecord,
} from './timed-action-types.js';

export interface LoopScanner {
  scan(input: { loopRunId: string; now: number }): LoopScanResult | Promise<LoopScanResult>;
}

export interface LoopScanResult {
  summaryEvidence?: {
    summary?: string;
    metadata?: Record<string, unknown>;
  };
  nextActionKind?: string;
  nextActionSummary?: string;
  openAnomalies?: unknown[];
  resolvedAnomalies?: unknown[];
  scannedOwners?: unknown[];
  scannedOwnerCount?: number;
  openAnomalyCount?: number;
  resolvedAnomalyCount?: number;
  anomalies?: unknown[];
}

export type RunLoopNowResult =
  | { status: 'publication_pending'; run: LoopRun }
  | { status: 'executing'; run: LoopRun }
  | { status: 'success'; run: LoopRun }
  | { status: 'blocked'; run: LoopRun }
  | { status: 'failed'; run: LoopRun }
  | { status: 'already_running'; activeRunId: string }
  | { status: 'already_completed'; completedRunId: string }
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' | 'deleted_loop' };

export interface LoopRunner {
  runLoopNow(loopId: string, trigger: LoopRunTrigger|undefined, signal: AbortSignal|undefined, context:LoopRunContext): Promise<RunLoopNowResult>;
}

export interface CreateLoopRunnerOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  scanner: LoopScanner;
  taskPort?: {recoverTask(taskId:string):Promise<import('../../src/runtime/task-host/types.js').TaskSnapshot|undefined>};
  scanners?: Record<string, LoopScanner>;
  userLoopTemplateRunner?: UserLoopTemplateRunner;
  finalizer?: LoopFinalizer;
  now?: () => number;
  staleAfterMs?: number;
}

export function createLoopRunner(options: CreateLoopRunnerOptions): LoopRunner {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;
  const finalizer = options.finalizer ?? createLoopFinalizer(options.loopStore);

  return {
    async runLoopNow(loopId, trigger, signal, rawContext) {
      const context=captureLoopRunContext(rawContext);
      const startedAt = now();
      assertRecoveredStaleRuns(options.loopStore.recoverStaleRuns(startedAt, staleAfterMs));
      const effectiveTrigger = trigger ?? { kind: 'manual' };
      const begin = options.loopStore.beginLoopRun(loopId, effectiveTrigger, startedAt, staleAfterMs,context);
      if (begin.status !== 'started') {
        if(begin.status==='already_running'){const run=options.loopStore.getLoopRun(begin.activeRunId);if(run&&options.loopStore.getLoopRunLifecycle(run.id)?.businessState==='publication_pending'){options.loopStore.recoverLoopPublicationCandidates({runId:run.id,requestSource:context.requestSource});return {status:'publication_pending',run};}if(run&&options.loopStore.getLoopRunPublicationBasis(run.id)?.contract.kind==='user-template'&&options.userLoopTemplateRunner?.recoverTemplateLoop)return options.userLoopTemplateRunner.recoverTemplateLoop({loopId:run.loopId,runId:run.id,requestSource:context.requestSource,signal});}
        if(begin.status==='already_completed'){const run=options.loopStore.getLoopRun(begin.completedRunId);if(!run)throw Error('loop_completion_missing');if(!await readLoopCompletedRun(options.loopStore,{runId:run.id,loopId,logicalRunKey:String(effectiveTrigger.logicalRunKey??'').trim(),requestSource:context.requestSource,...(signal?{signal}:{})},options.taskPort))return {status:'publication_pending',run};}
        return begin;
      }

      const run = begin.run;
      const producer=options.loopStore.getLoopRunPublicationBasis(run.id)?options.loopStore.openLoopPublicationProducer(run):undefined;
      if(!producer)assertOrdinaryLoopOwner('loop_run',run.id);
      const definition = options.loopStore.getLoopDefinition(loopId);
      if (definition?.origin === 'user_template') {
        if (!options.userLoopTemplateRunner) {
          const failed = options.loopStore.finishLoopRunFailure(
            run.id,
            'executor_failed',
            'User loop template runner is not configured.',
            [],
            startedAt
          );
          return resultFromPersistedRun(failed ?? run);
        }
        return options.userLoopTemplateRunner.runTemplateLoop({
          loopId,
          runId: run.id,
          trigger: effectiveTrigger,
          signal,
          requestSource:context.requestSource,
          producer,
        });
      }

      const stage = options.loopStore.startLoopStage(run.id, loopId, 'scan', startedAt, {
        trigger: effectiveTrigger,
      });

      try {
        const scanNow = now();
        const scanner = options.scanners?.[loopId] ?? options.scanner;
        const scan = await scanner.scan({ loopRunId: run.id, now: scanNow });
        const summary = scan.summaryEvidence?.summary ?? summarizeScan(scan);
        const metadata = diagnosticMetadata(scan);
        const finishedAt = now();
        const liveRun = options.loopStore.getLoopRun(run.id);
        if (!liveRun || liveRun.status !== 'running') {
          return resultFromPersistedRun(liveRun ?? run);
        }

        if(producer){producer.recordScan(stage.id,scan as Parameters<typeof producer.recordScan>[1],finishedAt);options.loopStore.recoverLoopPublicationCandidates({runId:run.id,requestSource:context.requestSource});return {status:'publication_pending',run:options.loopStore.getLoopRun(run.id)!};}

        if (scan.nextActionKind && scan.nextActionKind !== 'none') {
          const nextActionSummary = scan.nextActionSummary ?? summary;
          const stageEvidenceIds = recordBlockedCompletion(
            options.evidenceStore,
            'loop_stage',
            stage.id,
            finishedAt,
            nextActionSummary,
            metadata
          );
          options.loopStore.finishLoopStageBlocked(stage.id, stageEvidenceIds, nextActionSummary, finishedAt, metadata);
          const runEvidenceIds = recordBlockedCompletion(
            options.evidenceStore,
            'loop_run',
            run.id,
            finishedAt,
            nextActionSummary,
            metadata
          );
          const blocked = options.loopStore.finishLoopRunBlocked(
            run.id,
            runEvidenceIds,
            scan.nextActionKind,
            nextActionSummary,
            finishedAt
          );
          return resultFromPersistedRun(blocked ?? run);
        }

        const stageEvidenceIds = recordDiagnosticCompletion(
          options.evidenceStore,
          'loop_stage',
          stage.id,
          finishedAt,
          summary,
          metadata
        );
        options.loopStore.finishLoopStageSuccess(stage.id, stageEvidenceIds, finishedAt, summary, metadata);
        const runEvidenceIds = recordDiagnosticCompletion(
          options.evidenceStore,
          'loop_run',
          run.id,
          finishedAt,
          summary,
          metadata
        );
        const success = finalizer.finishSuccess({
          runId: run.id,
          evidenceIds: runEvidenceIds,
          now: finishedAt,
          summary,
        });
        return resultFromPersistedRun(success ?? run);
      } catch (error) {
        const finishedAt = now();
        const message = (error as Error).message || 'loop scanner failed';
        options.loopStore.finishLoopStageFailure(stage.id, 'executor_failed', message, [], finishedAt);
        const failed = options.loopStore.finishLoopRunFailure(run.id, 'executor_failed', message, [], finishedAt);
        return resultFromPersistedRun(failed ?? run);
      }
    },
  };
}

export interface CreateLoopExecutorOptions {
  runLoop: (loopId: string, trigger: LoopRunTrigger, signal: AbortSignal|undefined, context:LoopRunContext) => Promise<RunLoopNowResult> | RunLoopNowResult;
}

export function createLoopExecutor(options: CreateLoopExecutorOptions): TimedActionExecutorHandler {
  return {
    kind: 'loop',
    async execute(action, context, runtimeContext) {
      if (action.executor.kind !== 'loop') {
        return { skip: { action: 'skip', reason: `not a loop executor: ${action.executor.kind}` } };
      }
      const result = await options.runLoop(action.executor.loopId, scheduledLoopTrigger(action, context, runtimeContext), runtimeContext?.signal,{requestSource:'scheduler'});
      if(result.status==='publication_pending')return {decision:{loopRunId:result.run.id,loopStatus:'publication_pending'}};
      if(result.status==='executing')return {awaitingLoopRunId:result.run.id};
      if (result.status === 'already_running') {
        return { skip: { action: 'skip', reason: `loop already running: ${result.activeRunId}` } };
      }
      if (result.status === 'already_completed') {
        return {
          skip: { action: 'skip', reason: `logical_run_already_completed: ${result.completedRunId}` },
          decision: {
            loopRunId: result.completedRunId,
            loopStatus: 'success',
            reused: true,
          },
        };
      }
      if (result.status === 'skipped') {
        return { skip: { action: 'skip', reason: `loop ${result.reason}` } };
      }
      if (result.status !== result.run.status) {
        if (result.run.status === 'failed') {
          throw new Error(`loop failed: ${result.run.message ?? result.run.failureKind ?? result.run.id}`);
        }
        if (result.run.status === 'blocked') {
          return {
            decision: {
              loopRunId: result.run.id,
              loopStatus: 'blocked',
              nextActionKind: result.run.nextActionKind,
              nextActionSummary: result.run.nextActionSummary,
            },
          };
        }
      }
      if (result.status === 'failed') {
        throw new Error(`loop failed: ${result.run.message ?? result.run.failureKind ?? result.run.id}`);
      }
      return {
        decision: {
          loopRunId: result.run.id,
          loopStatus: result.status,
          nextActionKind: result.run.nextActionKind,
          nextActionSummary: result.run.nextActionSummary,
        },
      };
    },
  };
}

function resultFromPersistedRun(run: LoopRun): Extract<RunLoopNowResult, { run: LoopRun }> {
  switch (run.status) {
    case 'success':
      return { status: 'success', run };
    case 'blocked':
      return { status: 'blocked', run };
    case 'failed':
      return { status: 'failed', run };
    case 'running':
      return {status:'executing',run};
  }
}

export interface DesktopLoopRuntime {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  scanner: ArtifactEvidenceRegressionScanner;
  kswarmHealthScanner: KSwarmServiceHealthScanner;
  runner: LoopRunner;
  executor: TimedActionExecutorHandler;
  listAnomalies(loopId: string): unknown[];
  resolveTimedActionLoopRun(input: { action: TimedActionRecord; timedActionRunId: string }): LoopTimedActionDecision | undefined;
  close(): void;
}

export interface CreateDesktopLoopRuntimeOptions {
  acquireWriter?: (label: string) => { release(): void };
  dataRoot: string;
  now?: () => number;
  staleAfterMs?: number;
  loopDbPath?: string;
  completionEvidenceDbPath?: string;
  taskPort?: UserLoopTaskPort;
  llmPort?: LoopLLMPort;
  onConstraintAdded?: (constraint: LearnedConstraint) => void;
  kswarmHealthProbe?: () => KSwarmHealthDiagnosticInput | Promise<KSwarmHealthDiagnosticInput>;
  kswarmHealthLogPaths?: string[];
}

export function createDesktopLoopRuntime(options: CreateDesktopLoopRuntimeOptions): DesktopLoopRuntime {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;
  const dbPath = options.loopDbPath ?? options.completionEvidenceDbPath ?? join(options.dataRoot, 'loop-evidence.sqlite');
  const completionEvidenceDbPath = options.completionEvidenceDbPath ?? dbPath;
  const databases=createLoopDatabaseOwnerGroup([dbPath,completionEvidenceDbPath]);
  try{
  const loopStore = new LoopStore(databases.sources[0]);
  const evidenceStore = new CompletionEvidenceStore(databases.sources[1]);
  loopStore.ensureBuiltInLoops(now());
  assertRecoveredStaleRuns(loopStore.recoverStaleRuns(now(), staleAfterMs));
  const scanner = new ArtifactEvidenceRegressionScanner(databases.sources[1]);
  const kswarmHealthScanner = new KSwarmServiceHealthScanner(databases.sources[1], {
    probe: options.kswarmHealthProbe ?? defaultHealthyKSwarmHealthProbe,
    logPaths: options.kswarmHealthLogPaths,
  });
  const userLoopTemplateRunner = options.taskPort
    ? createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort: options.taskPort,
      acquireWriter: options.acquireWriter,
      llmPort: options.llmPort,
      onConstraintAdded: options.onConstraintAdded,
      now,
    })
    : undefined;
  const baseRunner = createLoopRunner({
    loopStore,
    evidenceStore,
    scanner,
    scanners: {
      [KSWARM_SERVICE_HEALTH_LOOP_ID]: kswarmHealthScanner,
    },
    userLoopTemplateRunner,
    taskPort: options.taskPort ? {recoverTask: async taskId => (await options.taskPort!.recoverTask(taskId)).snapshot ?? undefined} : undefined,
    now,
    staleAfterMs,
  });
  let accepting=true,pending=0,closed=false;
  const runner:LoopRunner={async runLoopNow(...args){if(!accepting)throw Error('loop_runtime_closed');pending++;try{return await baseRunner.runLoopNow(...args);}finally{pending--;}}};
  return {
    loopStore,
    evidenceStore,
    scanner,
    kswarmHealthScanner,
    runner,
    executor: createLoopExecutor({
      runLoop: (loopId, trigger, signal, context) => runner.runLoopNow(loopId, trigger, signal, context),
    }),
    listAnomalies(loopId) {
      if (loopId === KSWARM_SERVICE_HEALTH_LOOP_ID) {
        return kswarmHealthScanner.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID });
      }
      if (loopId === ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID) {
        return scanner.listAnomalies({ loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID });
      }
      return [];
    },
    resolveTimedActionLoopRun(input) {
      if (input.action.executor.kind !== 'loop') return undefined;
      const run = loopStore.findLoopRunByTimedActionRunId(input.timedActionRunId);
      if (!run || run.loopId !== input.action.executor.loopId) return undefined;
      const lifecycle=loopStore.getLoopRunLifecycle(run.id);
      if(run.status==='running'&&lifecycle?.businessState!=='publication_pending')return undefined;
      return {
        loopRunId: run.id,
        loopStatus: lifecycle?.businessState==='publication_pending'?'publication_pending':run.status as 'success'|'blocked'|'failed',
        nextActionKind: run.nextActionKind,
        nextActionSummary: run.nextActionSummary ?? run.message ?? run.summary,
      };
    },
    close() {
      if(closed)return;accepting=false;kswarmHealthScanner.stopAccepting();
      if(pending||kswarmHealthScanner.pendingScans)throw Error('loop_runtime_not_drained');
      kswarmHealthScanner.close();
      scanner.close();
      evidenceStore.close();
      loopStore.close();databases.close();closed=true;
    },
  };
  }catch(error){try{databases.close();}catch{/* Preserve the original construction failure. */}throw error;}
}

function assertRecoveredStaleRuns(result: ReturnType<LoopStore['recoverStaleRuns']>): void {
  if (result.ok) return;
  throw new Error(`Loop stale-run recovery failed: ${result.error}`);
}

function defaultHealthyKSwarmHealthProbe(): KSwarmHealthDiagnosticInput {
  return {
    expectedEntryPath: null,
    spawnEntryExists: true,
    port: { listening: true },
    health: {
      ok: true,
      body: {
        features: ['dynamic_workflows'],
        workflowCapabilities: {
          schemaVersion: 'kswarm_workflow_patterns_v1',
          compiledContract: true,
          patternPublicView: true,
        },
        brokerConnected: true,
      },
    },
    broker: { ok: true },
  };
}

function recordDiagnosticCompletion(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: Extract<CompletionOwnerKind, 'loop_stage' | 'loop_run'>,
  ownerId: string,
  now: number,
  summary: string,
  metadata: Record<string, unknown>
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['log_diagnostic'],
    source: expectationSourceForOwner(ownerKind),
    confidence: 'explicit',
    metadata: { loopContract: true },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'log_diagnostic',
    summary,
    metadata,
    now,
  });
  return evidenceStore.completeOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function recordBlockedCompletion(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: Extract<CompletionOwnerKind, 'loop_stage' | 'loop_run'>,
  ownerId: string,
  now: number,
  summary: string,
  metadata: Record<string, unknown>
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['blocked'],
    source: expectationSourceForOwner(ownerKind),
    confidence: 'explicit',
    metadata: { loopContract: true },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'blocked',
    summary,
    metadata,
    now,
  });
  return evidenceStore.blockOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function expectationSourceForOwner(ownerKind: 'loop_stage' | 'loop_run'): 'loop_stage_contract' | 'scheduler_executor_contract' {
  return ownerKind === 'loop_stage' ? 'loop_stage_contract' : 'scheduler_executor_contract';
}

function scheduledLoopTrigger(
  action: TimedActionRecord,
  context: OverdueRecoveryContext,
  runtimeContext?: TimedActionExecutorRuntimeContext
): LoopRunTrigger {
  return {
    kind: 'scheduled',
    timedActionId: action.id,
    timedActionRunId: runtimeContext?.timedActionRunId,
    scheduledDueAt: context.scheduledDueAt,
    claimedAt: context.claimedAt,
    overdueMs: context.overdueMs,
    recoveryReason: context.recoveryReason,
  };
}

function summarizeScan(scan: LoopScanResult): string {
  if (scan.nextActionKind && scan.nextActionKind !== 'none') {
    return `Loop scan requires ${scan.nextActionKind}.`;
  }
  return 'Loop scan completed.';
}

function diagnosticMetadata(scan: LoopScanResult): Record<string, unknown> {
  const metadata = {
    ...(scan.summaryEvidence?.metadata ?? {}),
    nextActionKind: scan.nextActionKind ?? 'none',
    nextActionSummary: scan.nextActionSummary,
    scannedOwnerCount: scan.scannedOwnerCount ?? scan.scannedOwners?.length,
    openAnomalyCount: scan.openAnomalyCount ?? scan.openAnomalies?.length,
    resolvedAnomalyCount: scan.resolvedAnomalyCount ?? scan.resolvedAnomalies?.length,
    anomalyCount: scan.anomalies?.length,
  };
  return stripUndefined({
    ...metadata,
    findings: normalizedFindings(metadata, scan),
  });
}

function normalizedFindings(metadata: Record<string, unknown>, scan: LoopScanResult): string[] {
  if (isNonEmptyStringArray(metadata.findings)) {
    return metadata.findings;
  }
  const openAnomalyCount = scan.openAnomalyCount ?? scan.openAnomalies?.length ?? scan.anomalies?.length ?? 0;
  const resolvedAnomalyCount = scan.resolvedAnomalyCount ?? scan.resolvedAnomalies?.length ?? 0;
  if (scan.nextActionKind && scan.nextActionKind !== 'none') {
    return [`${scan.nextActionKind}:${scan.nextActionSummary ?? 'action_required'}`];
  }
  if (openAnomalyCount > 0) {
    return [`open_anomalies:${openAnomalyCount}`];
  }
  if (resolvedAnomalyCount > 0) {
    return [`resolved_anomalies:${resolvedAnomalyCount}`];
  }
  const scannedOwnerCount = scan.scannedOwnerCount ?? scan.scannedOwners?.length ?? 0;
  return [`scan_completed:scanned_owners=${scannedOwnerCount}`];
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim().length > 0);
}
