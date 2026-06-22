import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { accessSync, constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
import type { CompletionOwnerKind } from './completion-evidence-types.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { extractViaLLM, extractViaRule } from './loop-llm-port.js';
import { LoopStore } from './loop-store.js';
import type { LearnedConstraint, LoopRun, LoopRunTrigger, UserLoopTemplate } from './loop-types.js';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';
import type { TaskCreateInput, TaskPermissionMode, TaskSnapshot } from '../../src/runtime/task-host/types.js';

export interface UserLoopTaskPort {
  createTask(input: TaskCreateInput): Promise<{ taskId: string }>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
}

export type UserLoopTemplateRunResult =
  | { status: 'success'; run: LoopRun }
  | { status: 'blocked'; run: LoopRun }
  | { status: 'failed'; run: LoopRun };

export interface CreateUserLoopTemplateRunnerOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  taskPort: UserLoopTaskPort;
  llmPort?: LoopLLMPort;
  now?: () => number;
  pollIntervalMs?: number;
  maxRunMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunUserLoopTemplateInput {
  loopId: string;
  runId: string;
  trigger: LoopRunTrigger;
}

export interface UserLoopTemplateRunner {
  runTemplateLoop(input: RunUserLoopTemplateInput): Promise<UserLoopTemplateRunResult> | UserLoopTemplateRunResult;
}

const DEFAULT_MAX_RUN_MS = 55 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
/**
 * Per-task host watchdog applied to user-loop template tasks. Must be larger
 * than DEFAULT_MAX_RUN_MS so the loop runner gets to call cancelTask before
 * the host's own watchdog fires.
 */
const DEFAULT_LOOP_TASK_WATCHDOG_MS = 65 * 60_000;

export function buildPromptWithConstraints(
  basePrompt: string,
  loopStore: LoopStore,
  loopId: string
): { prompt: string; injectedConstraintIds: string[] } {
  const active = loopStore.getActiveConstraints(loopId);
  if (!active.length) return { prompt: basePrompt, injectedConstraintIds: [] };

  const block = active.map((c, i) => `${i + 1}. ${c.rule}`).join('\n');
  const prompt = `${basePrompt}\n\n---\n以下规则必须遵守：\n${block}`;
  loopStore.bumpConstraintHits(active.map(c => c.id));
  return { prompt, injectedConstraintIds: active.map(c => c.id) };
}

export function runPreflight(template: UserLoopTemplate): { ok: true } | { ok: false; reason: string } {
  if (template.kind === 'markdown_file') {
    const dir = template.outputDirectory;
    if (!dir || !isAbsolute(dir)) {
      return { ok: false, reason: 'output_directory_not_absolute' };
    }
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, fsConstants.W_OK);
    } catch {
      return { ok: false, reason: 'output_directory_not_writable' };
    }
  }
  return { ok: true };
}

export function createUserLoopTemplateRunner(options: CreateUserLoopTemplateRunnerOptions): UserLoopTemplateRunner {
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastTimestamp = 0;
  const timestamp = () => {
    const current = now();
    lastTimestamp = Math.max(current, lastTimestamp + 1);
    return lastTimestamp;
  };

  async function runMarkdownFileLoop(
    template: UserLoopTemplate,
    input: RunUserLoopTemplateInput
  ): Promise<UserLoopTemplateRunResult> {
    const runStartMs = now();
    const outputTarget = resolveUserLoopOutputTarget(template);
    if (!outputTarget.ok) {
      return blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        outputTarget.nextActionKind,
        outputTarget.message,
        outputTarget.metadata,
        timestamp()
      );
    }

    const outputPath = outputTarget.outputPath;

    // Preflight: fast environment check before consuming agent resources
    const preflight = runPreflight(template);
    if (!preflight.ok) {
      const result = blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        'preflight_failed',
        `Preflight failed: ${preflight.reason}`,
        { reason: preflight.reason },
        timestamp()
      );
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    // Expire stale constraints before injection
    options.loopStore.deactivateStaleConstraints(input.loopId, now());

    // Inject active constraints into prompt
    const { prompt: enhancedPrompt, injectedConstraintIds } = buildPromptWithConstraints(
      buildMarkdownLoopPrompt(template, outputPath),
      options.loopStore,
      input.loopId
    );

    const executeStartedAt = timestamp();
    const executeStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'execute', executeStartedAt, {
      trigger: input.trigger,
      outputPath,
      injectedConstraintIds,
    });

    let taskId: string;
    try {
      mkdirSync(template.outputDirectory, { recursive: true });
      const created = await options.taskPort.createTask({
        prompt: enhancedPrompt,
        materials: [],
        permissionMode: permissionModeFor(input.trigger, template),
        watchdogMs: DEFAULT_LOOP_TASK_WATCHDOG_MS,
        maxToolLoopIterations: 500,
      });
      taskId = created.taskId;
    } catch (error) {
      const message = (error as Error).message || 'User loop task creation failed.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      return failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
    }

    const snapshot = await waitForTerminalSnapshot({
      taskPort: options.taskPort,
      taskId,
      maxRunMs,
      pollIntervalMs,
      sleep,
    });
    if (snapshot.status !== 'completed') {
      const errorEvent = [...(snapshot.events ?? [])].reverse().find(e => (e as any).type === 'error') as { type: 'error'; message?: string } | undefined;
      const errorReason = errorEvent?.message
        || snapshot.result?.summary?.split('\n')[0]?.slice(0, 200)
        || (snapshot.salvage?.reason)
        || `状态 ${snapshot.status}`;
      const message = `用户循环任务${snapshot.status === 'failed' ? '失败' : '未完成'}：${errorReason}`;
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      triggerAsyncExtraction(options, input, template, 'executor_failed', errorReason, snapshot);
      return result;
    }

    options.loopStore.finishLoopStageSuccess(executeStage.id, [], timestamp(), `Task ${taskId} completed.`, { taskId });
    const verifyStartedAt = timestamp();
    const verifyStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'verify', verifyStartedAt, {
      taskId,
      outputPath,
      injectedConstraintIds,
    });

    // Fallback: if task completed but file doesn't exist, try extracting from result.summary
    if (!existsSync(outputPath) && snapshot.result?.summary) {
      const summary = snapshot.result.summary;
      const hasMarkdownStructure = /^#\s+.+/m.test(summary) && summary.length > 500;
      if (hasMarkdownStructure) {
        try {
          const cleaned = summary.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
          writeFileSync(outputPath, cleaned, 'utf-8');
        } catch {
          // write failure continues to normal verify flow
        }
      }
    }

    const fileCheck = verifyMarkdownFile(outputPath);
    if (!fileCheck.ok) {
      const message = `Missing markdown file artifact: ${outputPath}`;
      const stageEvidenceIds = recordBlockedEvidence(options.evidenceStore, 'loop_stage', verifyStage.id, timestamp(), message, {
        outputPath,
        reason: fileCheck.reason,
      });
      options.loopStore.finishLoopStageBlocked(verifyStage.id, stageEvidenceIds, message, timestamp(), {
        outputPath,
        reason: fileCheck.reason,
      });
      const runEvidenceIds = recordBlockedEvidence(options.evidenceStore, 'loop_run', input.runId, timestamp(), message, {
        outputPath,
        reason: fileCheck.reason,
      });
      const blocked = options.loopStore.finishLoopRunBlocked(
        input.runId,
        runEvidenceIds,
        'missing_file_artifact',
        message,
        timestamp()
      );
      const result = resultFromRun('blocked', blocked, input.runId, options.loopStore);
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      // Verify failed: increment ineffective for injected constraints and trigger extraction
      if (injectedConstraintIds.length > 0) {
        options.loopStore.incrementConsecutiveIneffective(injectedConstraintIds);
      }
      triggerAsyncExtraction(options, input, template, 'missing_file_artifact', fileCheck.reason, snapshot);
      return result;
    }

    // Verify success: reset ineffective counters
    if (injectedConstraintIds.length > 0) {
      options.loopStore.resetConsecutiveIneffective(injectedConstraintIds);
    }

    const summary = `Markdown file artifact verified: ${outputPath}`;
    const stageEvidenceIds = recordFileArtifactEvidence(options.evidenceStore, 'loop_stage', verifyStage.id, timestamp(), summary, outputPath);
    options.loopStore.finishLoopStageSuccess(verifyStage.id, stageEvidenceIds, timestamp(), summary, { outputPath });
    const runEvidenceIds = recordFileArtifactEvidence(options.evidenceStore, 'loop_run', input.runId, timestamp(), summary, outputPath);
    const success = options.loopStore.finishLoopRunSuccess(input.runId, runEvidenceIds, timestamp(), summary);
    const result = resultFromRun('success', success, input.runId, options.loopStore);
    recordDuration(options.loopStore, input.runId, runStartMs, now());
    return result;
  }

  async function runTaskCompletionLoop(
    template: UserLoopTemplate,
    input: RunUserLoopTemplateInput
  ): Promise<UserLoopTemplateRunResult> {
    const runStartMs = now();
    const effectivePermission = permissionModeFor(input.trigger, template);

    if (effectivePermission === 'plan' && input.trigger.kind === 'scheduled') {
      return blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        'awaiting_auto_run_approval',
        'Scheduled task_completion loop requires autoRunApproved=true to execute.',
        { permissionMode: 'plan', loopId: input.loopId },
        timestamp()
      );
    }

    // Expire stale constraints before injection
    options.loopStore.deactivateStaleConstraints(input.loopId, now());

    // Inject active constraints into prompt
    const { prompt: enhancedPrompt, injectedConstraintIds } = buildPromptWithConstraints(
      template.prompt,
      options.loopStore,
      input.loopId
    );

    const executeStartedAt = timestamp();
    const executeStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'execute', executeStartedAt, {
      trigger: input.trigger,
      injectedConstraintIds,
    });

    let taskId: string;
    try {
      const created = await options.taskPort.createTask({
        prompt: enhancedPrompt,
        materials: [],
        permissionMode: effectivePermission,
        watchdogMs: DEFAULT_LOOP_TASK_WATCHDOG_MS,
        maxToolLoopIterations: 500,
      });
      taskId = created.taskId;
    } catch (error) {
      const message = (error as Error).message || 'Task creation failed.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    options.loopStore.updateLoopStageMetadata(executeStage.id, { taskId });

    const snapshot = await waitForTerminalSnapshot({
      taskPort: options.taskPort,
      taskId,
      maxRunMs,
      pollIntervalMs,
      sleep,
      onPoll: () => options.loopStore.touchLoopRun(input.runId, timestamp()),
    });

    if (snapshot.status !== 'completed') {
      const message = snapshot.status === 'cancelled'
        ? `Task auto-cancelled after ${Math.round(maxRunMs / 60_000)} minutes timeout.`
        : `Task ended with status: ${snapshot.status}`;
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      triggerAsyncExtraction(options, input, template, 'executor_failed', message, snapshot);
      return result;
    }

    // Success: reset ineffective counters
    if (injectedConstraintIds.length > 0) {
      options.loopStore.resetConsecutiveIneffective(injectedConstraintIds);
    }

    const summary = `Task ${taskId} completed. Prompt: ${template.prompt.slice(0, 80)}`;
    options.loopStore.finishLoopStageSuccess(executeStage.id, [], timestamp(), summary, { taskId });
    const runEvidenceIds = recordTaskCompletionEvidence(
      options.evidenceStore, 'loop_run', input.runId, timestamp(), summary,
      { taskId, promptPreview: template.prompt.slice(0, 100) }
    );
    const success = options.loopStore.finishLoopRunSuccess(input.runId, runEvidenceIds, timestamp(), summary);
    const result = resultFromRun('success', success, input.runId, options.loopStore);
    recordDuration(options.loopStore, input.runId, runStartMs, now());
    return result;
  }

  return {
    async runTemplateLoop(input: RunUserLoopTemplateInput): Promise<UserLoopTemplateRunResult> {
      const template = options.loopStore.getUserLoopTemplate(input.loopId);
      if (!template) {
        return failRun(options.loopStore, input.runId, 'validation_failed', 'User loop template does not exist.', timestamp());
      }
      if (template.kind === 'task_completion') {
        return runTaskCompletionLoop(template, input);
      }
      return runMarkdownFileLoop(template, input);
    },
  };
}

function buildMarkdownLoopPrompt(template: UserLoopTemplate, outputPath: string): string {
  return [
    template.prompt,
    '',
    'Write the final Markdown artifact to this exact path:',
    outputPath,
    '',
    'The loop is successful only if that Markdown file exists and is non-empty.',
  ].join('\n');
}

function permissionModeFor(trigger: LoopRunTrigger, template: UserLoopTemplate): TaskPermissionMode {
  if (trigger.kind === 'scheduled' && !template.autoRunApproved) return 'plan';
  return 'default';
}

function resolveUserLoopOutputTarget(template: UserLoopTemplate):
  | { ok: true; outputDirectory: string; outputPath: string }
  | { ok: false; nextActionKind: string; message: string; metadata: Record<string, unknown> } {
  if (!isAbsolute(template.outputDirectory)) {
    return {
      ok: false,
      nextActionKind: 'repair_output_directory',
      message: `User loop requires an absolute output directory before it can run: ${template.outputDirectory}`,
      metadata: {
        reason: 'relative_output_directory',
        outputDirectory: template.outputDirectory,
      },
    };
  }
  if (!isSafeLoopOutputFileName(template.outputFileName)) {
    return {
      ok: false,
      nextActionKind: 'repair_output_file_name',
      message: `User loop output filename must be a safe file name: ${template.outputFileName}`,
      metadata: {
        reason: 'unsafe_output_file_name',
        outputFileName: template.outputFileName,
      },
    };
  }
  const outputDirectory = resolve(template.outputDirectory);
  const outputPath = resolve(outputDirectory, template.outputFileName);
  if (dirname(outputPath) !== outputDirectory) {
    return {
      ok: false,
      nextActionKind: 'repair_output_file_name',
      message: `User loop output filename must stay inside the output directory: ${template.outputFileName}`,
      metadata: {
        reason: 'output_path_escape',
        outputDirectory: template.outputDirectory,
        outputFileName: template.outputFileName,
      },
    };
  }
  return { ok: true, outputDirectory, outputPath };
}

async function waitForTerminalSnapshot(input: {
  taskPort: UserLoopTaskPort;
  taskId: string;
  maxRunMs: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  onPoll?: () => void;
}): Promise<TaskSnapshot> {
  const startedAt = Date.now();
  while (true) {
    const { snapshot } = await input.taskPort.recoverTask(input.taskId);
    if (isTerminalTaskSnapshot(snapshot)) return snapshot;
    input.onPoll?.();
    if (Date.now() - startedAt >= input.maxRunMs) {
      try {
        await input.taskPort.cancelTask(input.taskId, 'loop_poll_timeout');
      } catch {
        // cancelTask may legitimately fail (task already terminal, snapshot
        // gone, etc.). The poll timeout has elapsed regardless; fall through
        // and report the latest snapshot we can observe.
      }
      try {
        const { snapshot: final } = await input.taskPort.recoverTask(input.taskId);
        if (isTerminalTaskSnapshot(final)) return final;
        return { ...final, status: 'failed' };
      } catch {
        return { ...snapshot, status: 'failed' };
      }
    }
    await input.sleep(input.pollIntervalMs);
  }
}

function isTerminalTaskSnapshot(snapshot: TaskSnapshot): boolean {
  return snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
}

function verifyMarkdownFile(outputPath: string): { ok: true } | { ok: false; reason: string } {
  try {
    const stat = statSync(outputPath);
    if (!stat.isFile()) return { ok: false, reason: 'not_file' };
    if (stat.size <= 0) return { ok: false, reason: 'empty_file' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'missing_file' };
  }
}

function recordTaskCompletionEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  metadata: { taskId: string; promptPreview: string }
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['answer'],
    source: 'loop_stage_contract',
    confidence: 'explicit',
    metadata: { loopContract: true, ...metadata },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'answer',
    summary,
    metadata: { ...metadata, responseId: metadata.taskId },
    now,
  });
  return evidenceStore.completeOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function recordFileArtifactEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  outputPath: string
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['file_artifact'],
    source: 'loop_stage_contract',
    confidence: 'explicit',
    metadata: { loopContract: true, outputPath },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'file_artifact',
    summary,
    metadata: { paths: [outputPath] },
    now,
  });
  return evidenceStore.completeOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function recordBlockedEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  metadata: Record<string, unknown>
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['blocked'],
    source: 'loop_stage_contract',
    confidence: 'explicit',
    metadata,
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

function failRun(
  loopStore: LoopStore,
  runId: string,
  failureKind: 'executor_failed' | 'validation_failed' | 'executor_crash',
  message: string,
  now: number
): UserLoopTemplateRunResult {
  const failed = loopStore.finishLoopRunFailure(runId, failureKind, message, [], now);
  return resultFromRun('failed', failed, runId, loopStore);
}

function blockRun(
  loopStore: LoopStore,
  evidenceStore: CompletionEvidenceStore,
  runId: string,
  nextActionKind: string,
  nextActionSummary: string,
  metadata: Record<string, unknown>,
  now: number
): UserLoopTemplateRunResult {
  const evidenceIds = recordBlockedEvidence(evidenceStore, 'loop_run', runId, now, nextActionSummary, metadata);
  const blocked = loopStore.finishLoopRunBlocked(runId, evidenceIds, nextActionKind, nextActionSummary, now);
  return resultFromRun('blocked', blocked, runId, loopStore);
}

function resultFromRun(
  status: UserLoopTemplateRunResult['status'],
  run: LoopRun | undefined,
  runId: string,
  loopStore: LoopStore
): UserLoopTemplateRunResult {
  const persisted = run ?? loopStore.getLoopRun(runId);
  if (!persisted) {
    throw new Error('User loop run did not persist a terminal state.');
  }
  return { status, run: persisted } as UserLoopTemplateRunResult;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function recordDuration(loopStore: LoopStore, runId: string, startMs: number, endMs: number): void {
  const durationMs = Math.max(0, endMs - startMs);
  loopStore.finishLoopRunWithDuration(runId, durationMs);
}

function triggerAsyncExtraction(
  options: CreateUserLoopTemplateRunnerOptions,
  input: RunUserLoopTemplateInput,
  template: UserLoopTemplate,
  failureKind: string,
  failureReason: string,
  snapshot: TaskSnapshot
): void {
  const llmPort = options.llmPort;
  if (!llmPort) return;

  const extractionContext = JSON.stringify({
    loopTitle: template.prompt.slice(0, 100),
    failureKind,
    failureReason: failureReason.slice(0, 300),
  }).slice(0, 500);

  const extractionInput = {
    loopTitle: template.prompt.slice(0, 100),
    loopPrompt: template.prompt.slice(0, 500),
    failureKind,
    failureMessage: failureReason.slice(0, 300),
    lastAgentOutput: snapshot.result?.summary?.slice(-500) ?? '',
  };

  setImmediate(async () => {
    try {
      const rule = await extractViaLLM(llmPort, extractionInput);
      if (rule) {
        options.loopStore.addConstraint({
          loopId: input.loopId,
          source: 'llm_extraction',
          rule,
          sourceRunId: input.runId,
          failureKind,
          failureReason,
          extractionContext,
          now: Date.now(),
        });
      }
    } catch {
      // LLM failed, try rule fallback
      const fallback = extractViaRule(failureKind, failureReason);
      if (fallback) {
        options.loopStore.addConstraint({
          loopId: input.loopId,
          source: 'rule_extraction',
          rule: fallback,
          sourceRunId: input.runId,
          failureKind,
          failureReason,
          extractionContext,
          now: Date.now(),
        });
      }
    }
  });
}
