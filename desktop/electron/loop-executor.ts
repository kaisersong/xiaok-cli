import { join } from 'node:path';
import { ArtifactEvidenceRegressionScanner } from './artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
import { LoopStore } from './loop-store.js';
import type {
  LoopRun,
  LoopRunTrigger,
} from './loop-types.js';
import type {
  CompletionOwnerKind,
} from './completion-evidence-types.js';
import type {
  OverdueRecoveryContext,
  TimedActionExecutorHandler,
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
  | { status: 'skipped'; reason: 'paused' | 'missing_loop' };

export interface LoopRunner {
  runLoopNow(loopId: string, trigger?: LoopRunTrigger): Promise<RunLoopNowResult>;
}

export interface CreateLoopRunnerOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  scanner: LoopScanner;
  now?: () => number;
  staleAfterMs?: number;
}

export function createLoopRunner(options: CreateLoopRunnerOptions): LoopRunner {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;

  return {
    async runLoopNow(loopId, trigger) {
      const startedAt = now();
      options.loopStore.recoverStaleRuns(startedAt, staleAfterMs);
      const effectiveTrigger = trigger ?? { kind: 'manual' };
      const begin = options.loopStore.beginLoopRun(loopId, effectiveTrigger, startedAt, staleAfterMs);
      if (begin.status !== 'started') {
        return begin;
      }

      const run = begin.run;
      const stage = options.loopStore.startLoopStage(run.id, loopId, 'scan', startedAt, {
        trigger: effectiveTrigger,
      });

      try {
        const scanNow = now();
        const scan = await options.scanner.scan({ loopRunId: run.id, now: scanNow });
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
    async execute(action, context) {
      if (action.executor.kind !== 'loop') {
        return { skip: { action: 'skip', reason: `not a loop executor: ${action.executor.kind}` } };
      }
      const result = await options.runLoop(action.executor.loopId, scheduledLoopTrigger(action, context));
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
  runner: LoopRunner;
  executor: TimedActionExecutorHandler;
  close(): void;
}

export interface CreateDesktopLoopRuntimeOptions {
  dataRoot: string;
  now?: () => number;
  staleAfterMs?: number;
  loopDbPath?: string;
  completionEvidenceDbPath?: string;
}

export function createDesktopLoopRuntime(options: CreateDesktopLoopRuntimeOptions): DesktopLoopRuntime {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;
  const dbPath = options.loopDbPath ?? options.completionEvidenceDbPath ?? join(options.dataRoot, 'loop-evidence.sqlite');
  const completionEvidenceDbPath = options.completionEvidenceDbPath ?? dbPath;
  const loopStore = new LoopStore(dbPath);
  const evidenceStore = new CompletionEvidenceStore(completionEvidenceDbPath);
  loopStore.ensureBuiltInLoops(now());
  loopStore.recoverStaleRuns(now(), staleAfterMs);
  const scanner = new ArtifactEvidenceRegressionScanner(completionEvidenceDbPath);
  const runner = createLoopRunner({
    loopStore,
    evidenceStore,
    scanner,
    now,
    staleAfterMs,
  });
  return {
    loopStore,
    evidenceStore,
    scanner,
    runner,
    executor: createLoopExecutor({
      runLoop: (loopId, trigger) => runner.runLoopNow(loopId, trigger),
    }),
    close() {
      scanner.close();
      evidenceStore.close();
      loopStore.close();
    },
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

function scheduledLoopTrigger(action: TimedActionRecord, context: OverdueRecoveryContext): LoopRunTrigger {
  return {
    kind: 'scheduled',
    timedActionId: action.id,
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
