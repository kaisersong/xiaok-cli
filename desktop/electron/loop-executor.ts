import { join } from 'node:path';
import {
  ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
  ArtifactEvidenceRegressionScanner,
} from './artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
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
  | { status: 'success'; run: LoopRun }
  | { status: 'blocked'; run: LoopRun }
  | { status: 'failed'; run: LoopRun }
  | { status: 'already_running'; activeRunId: string }
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' | 'deleted_loop' };

export interface LoopRunner {
  runLoopNow(loopId: string, trigger?: LoopRunTrigger): Promise<RunLoopNowResult>;
}

export interface CreateLoopRunnerOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  scanner: LoopScanner;
  scanners?: Record<string, LoopScanner>;
  userLoopTemplateRunner?: UserLoopTemplateRunner;
  now?: () => number;
  staleAfterMs?: number;
}

export function createLoopRunner(options: CreateLoopRunnerOptions): LoopRunner {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;

  return {
    async runLoopNow(loopId, trigger) {
      const startedAt = now();
      assertRecoveredStaleRuns(options.loopStore.recoverStaleRuns(startedAt, staleAfterMs));
      const effectiveTrigger = trigger ?? { kind: 'manual' };
      const begin = options.loopStore.beginLoopRun(loopId, effectiveTrigger, startedAt, staleAfterMs);
      if (begin.status !== 'started') {
        return begin;
      }

      const run = begin.run;
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
        const success = options.loopStore.finishLoopRunSuccess(run.id, runEvidenceIds, finishedAt, summary);
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
  runLoop: (loopId: string, trigger: LoopRunTrigger) => Promise<RunLoopNowResult> | RunLoopNowResult;
}

export function createLoopExecutor(options: CreateLoopExecutorOptions): TimedActionExecutorHandler {
  return {
    kind: 'loop',
    async execute(action, context, runtimeContext) {
      if (action.executor.kind !== 'loop') {
        return { skip: { action: 'skip', reason: `not a loop executor: ${action.executor.kind}` } };
      }
      const result = await options.runLoop(action.executor.loopId, scheduledLoopTrigger(action, context, runtimeContext));
      if (result.status === 'already_running') {
        return { skip: { action: 'skip', reason: `loop already running: ${result.activeRunId}` } };
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
      return { status: 'failed', run: { ...run, status: 'failed', failureKind: 'unknown', message: 'Loop run remained running after executor completion.' } };
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
  const loopStore = new LoopStore(dbPath);
  const evidenceStore = new CompletionEvidenceStore(completionEvidenceDbPath);
  loopStore.ensureBuiltInLoops(now());
  assertRecoveredStaleRuns(loopStore.recoverStaleRuns(now(), staleAfterMs));
  const scanner = new ArtifactEvidenceRegressionScanner(completionEvidenceDbPath);
  const kswarmHealthScanner = new KSwarmServiceHealthScanner(completionEvidenceDbPath, {
    probe: options.kswarmHealthProbe ?? defaultHealthyKSwarmHealthProbe,
    logPaths: options.kswarmHealthLogPaths,
  });
  const userLoopTemplateRunner = options.taskPort
    ? createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort: options.taskPort,
      llmPort: options.llmPort,
      onConstraintAdded: options.onConstraintAdded,
      now,
    })
    : undefined;
  const runner = createLoopRunner({
    loopStore,
    evidenceStore,
    scanner,
    scanners: {
      [KSWARM_SERVICE_HEALTH_LOOP_ID]: kswarmHealthScanner,
    },
    userLoopTemplateRunner,
    now,
    staleAfterMs,
  });
  return {
    loopStore,
    evidenceStore,
    scanner,
    kswarmHealthScanner,
    runner,
    executor: createLoopExecutor({
      runLoop: (loopId, trigger) => runner.runLoopNow(loopId, trigger),
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
      if (!run || run.loopId !== input.action.executor.loopId || run.status === 'running') return undefined;
      return {
        loopRunId: run.id,
        loopStatus: run.status,
        nextActionKind: run.nextActionKind,
        nextActionSummary: run.nextActionSummary ?? run.message ?? run.summary,
      };
    },
    close() {
      kswarmHealthScanner.close();
      scanner.close();
      evidenceStore.close();
      loopStore.close();
    },
  };
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
