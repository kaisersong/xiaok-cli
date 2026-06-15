import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  TaskCreateInput,
  TaskPermissionMode,
  TaskSnapshot,
} from '../../src/runtime/task-host/types.js';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
import type { CompletionOwnerKind } from './completion-evidence-types.js';
import { LoopStore } from './loop-store.js';
import type {
  LoopRun,
  LoopRunFailureKind,
  LoopRunTrigger,
  UserLoopTemplate,
} from './loop-types.js';

export interface UserLoopTaskPort {
  createTask(input: TaskCreateInput): Promise<{ taskId: string }>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
}

export type UserLoopTemplateRunResult =
  | { status: 'success'; run: LoopRun }
  | { status: 'blocked'; run: LoopRun; nextActionKind: string; nextActionSummary: string }
  | { status: 'failed'; run: LoopRun };

export interface UserLoopTemplateRunner {
  runTemplateLoop(input: {
    loopId: string;
    runId: string;
    trigger: LoopRunTrigger;
  }): Promise<UserLoopTemplateRunResult>;
}

export interface CreateUserLoopTemplateRunnerOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  taskPort: UserLoopTaskPort;
  now?: () => number;
  pollIntervalMs?: number;
  maxRunMs?: number;
}

export function createUserLoopTemplateRunner(options: CreateUserLoopTemplateRunnerOptions): UserLoopTemplateRunner {
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxRunMs = options.maxRunMs ?? 30 * 60_000;

  return {
    async runTemplateLoop(input) {
      const template = options.loopStore.getUserLoopTemplate(input.loopId);
      if (!template) {
        const failed = options.loopStore.finishLoopRunFailure(
          input.runId,
          'validation_failed',
          `User loop template not found: ${input.loopId}`,
          [],
          now()
        );
        return { status: 'failed', run: failed ?? fallbackFailedRun(input.loopId, input.runId, input.trigger, now()) };
      }

      const executeStartedAt = now();
      const executeStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'execute', executeStartedAt, {
        trigger: input.trigger,
        outputPath: outputPathForTemplate(template),
      });

      let taskId: string | undefined;
      try {
        mkdirSync(template.outputDirectory, { recursive: true });
        const created = await options.taskPort.createTask({
          prompt: buildMarkdownLoopPrompt(template, input.trigger),
          materials: [],
          permissionMode: permissionModeForTrigger(template, input.trigger),
        });
        taskId = created.taskId;
        const outputPath = outputPathForTemplate(template);
        const snapshot = await waitForTerminalTaskSnapshot({
          taskPort: options.taskPort,
          taskId,
          pollIntervalMs,
          maxRunMs,
        });
        const recoveredOutput = snapshot.status === 'failed'
          ? recoverMarkdownOutput(snapshot, outputPath)
          : undefined;
        options.loopStore.finishLoopStageSuccess(executeStage.id, [], now(), taskStageSummary(snapshot), {
          ...executeStage.metadata,
          taskId,
          taskStatus: snapshot.status,
          ...(recoveredOutput ? {
            recoveryKind: recoveredOutput.kind,
            recoveredOutputPath: recoveredOutput.outputPath,
          } : {}),
        });

        if (snapshot.status !== 'completed' && !recoveredOutput) {
          return failRun({
            loopStore: options.loopStore,
            loopId: input.loopId,
            runId: input.runId,
            failureKind: 'executor_failed',
            message: `User loop task ended with status ${snapshot.status}.`,
            now: now(),
          });
        }

        const verifyStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'verify', now(), {
          taskId,
          outputPath: outputPathForTemplate(template),
        });
        const verification = verifyMarkdownOutput(template);
        if (!verification.ok) {
          const summary = `Missing Markdown file artifact: ${template.outputFileName}`;
          const metadata = {
            taskId,
            outputPath: verification.outputPath,
            missingPath: verification.outputPath,
            findings: [verification.reason],
          };
          const stageEvidenceIds = recordBlockedCompletion(
            options.evidenceStore,
            'loop_stage',
            verifyStage.id,
            now(),
            summary,
            metadata
          );
          options.loopStore.finishLoopStageBlocked(verifyStage.id, stageEvidenceIds, summary, now(), metadata);
          const runEvidenceIds = recordBlockedCompletion(
            options.evidenceStore,
            'loop_run',
            input.runId,
            now(),
            summary,
            metadata
          );
          const blocked = options.loopStore.finishLoopRunBlocked(
            input.runId,
            runEvidenceIds,
            'missing_file_artifact',
            summary,
            now()
          );
          return {
            status: 'blocked',
            run: requireRun(blocked, options.loopStore, input.runId),
            nextActionKind: 'missing_file_artifact',
            nextActionSummary: summary,
          };
        }

        const summary = `Markdown file artifact verified: ${template.outputFileName}`;
        const metadata = {
          taskId,
          paths: [verification.outputPath],
          workspaceRoot: template.outputDirectory,
          localPaths: [template.outputFileName],
          ...(recoveredOutput ? { recoveredFrom: recoveredOutput.kind } : {}),
          verification: [{
            kind: 'file_exists',
            status: 'passed',
            summary,
          }],
        };
        const stageEvidenceIds = recordFileArtifactCompletion(
          options.evidenceStore,
          'loop_stage',
          verifyStage.id,
          now(),
          summary,
          metadata
        );
        options.loopStore.finishLoopStageSuccess(verifyStage.id, stageEvidenceIds, now(), summary, metadata);
        const runEvidenceIds = recordFileArtifactCompletion(
          options.evidenceStore,
          'loop_run',
          input.runId,
          now(),
          summary,
          metadata
        );
        const success = options.loopStore.finishLoopRunSuccess(input.runId, runEvidenceIds, now(), summary);
        return { status: 'success', run: requireRun(success, options.loopStore, input.runId) };
      } catch (error) {
        options.loopStore.finishLoopStageFailure(
          executeStage.id,
          'executor_failed',
          (error as Error).message || 'User loop task failed.',
          [],
          now(),
          { ...executeStage.metadata, taskId }
        );
        return failRun({
          loopStore: options.loopStore,
          loopId: input.loopId,
          runId: input.runId,
          failureKind: 'executor_failed',
          message: (error as Error).message || 'User loop task failed.',
          now: now(),
        });
      }
    },
  };
}

function permissionModeForTrigger(template: UserLoopTemplate, trigger: LoopRunTrigger): TaskPermissionMode {
  if (trigger.kind === 'scheduled' && !template.autoRunApproved) return 'plan';
  return 'default';
}

function buildMarkdownLoopPrompt(template: UserLoopTemplate, trigger: LoopRunTrigger): string {
  const outputPath = outputPathForTemplate(template);
  return [
    '[SYSTEM: This is a Xiaok user Loop run. Produce the required durable file artifact before claiming completion.]',
    `[SYSTEM: loop_id=${template.loopId}; trigger_kind=${String(trigger.kind)}]`,
    `[SYSTEM: output_path=${outputPath}]`,
    '[SYSTEM: Xiaok creates the output directory before this task starts.]',
    '[SYSTEM: Success requires a non-empty Markdown file at output_path.]',
    '[SYSTEM: Preferred final handoff: place the complete Markdown report between XIAOK_LOOP_MARKDOWN_START and XIAOK_LOOP_MARKDOWN_END. Xiaok will write that block to output_path and verify the file.]',
    '[SYSTEM: Do not print literal <tool_call> blocks. If you use tools, invoke them normally before the final handoff.]',
    '',
    template.prompt,
  ].join('\n');
}

async function waitForTerminalTaskSnapshot(input: {
  taskPort: UserLoopTaskPort;
  taskId: string;
  pollIntervalMs: number;
  maxRunMs: number;
}): Promise<TaskSnapshot> {
  const maxAttempts = Math.max(1, Math.ceil(input.maxRunMs / Math.max(1, input.pollIntervalMs)));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { snapshot } = await input.taskPort.recoverTask(input.taskId);
    if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      return snapshot;
    }
    await delay(input.pollIntervalMs);
  }
  throw new Error(`User loop task timed out: ${input.taskId}`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function verifyMarkdownOutput(template: UserLoopTemplate): { ok: true; outputPath: string } | { ok: false; outputPath: string; reason: string } {
  const outputPath = outputPathForTemplate(template);
  if (!existsSync(outputPath)) return { ok: false, outputPath, reason: 'missing_file_artifact' };
  try {
    const stat = statSync(outputPath);
    if (!stat.isFile()) return { ok: false, outputPath, reason: 'artifact_path_is_not_file' };
    if (stat.size <= 0) return { ok: false, outputPath, reason: 'artifact_file_empty' };
    return { ok: true, outputPath };
  } catch (error) {
    return {
      ok: false,
      outputPath,
      reason: `artifact_stat_failed:${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

function recoverMarkdownOutput(
  snapshot: TaskSnapshot,
  outputPath: string
): { kind: 'bounded_markdown_block' | 'textual_write_tool_call' | 'task_summary_failure_diagnostic'; outputPath: string } | undefined {
  const summary = snapshot.result?.summary;
  if (!summary) return undefined;

  const markdownBlock = extractLastBoundedMarkdownBlock(summary);
  if (markdownBlock?.trim()) {
    writeFileSync(outputPath, markdownBlock.trim(), 'utf8');
    return { kind: 'bounded_markdown_block', outputPath };
  }

  const write = extractLastTextualWriteForPath(summary, outputPath);
  if (write?.content.trim()) {
    writeFileSync(outputPath, write.content, 'utf8');
    return { kind: 'textual_write_tool_call', outputPath };
  }

  if (shouldMaterializeFailureDiagnostic(snapshot, summary)) {
    writeFileSync(outputPath, buildFailureDiagnosticMarkdown(snapshot, outputPath), 'utf8');
    return { kind: 'task_summary_failure_diagnostic', outputPath };
  }

  return undefined;
}

function extractLastBoundedMarkdownBlock(text: string): string | undefined {
  const startMarker = 'XIAOK_LOOP_MARKDOWN_START';
  const endMarker = 'XIAOK_LOOP_MARKDOWN_END';
  const blockRegex = /XIAOK_LOOP_MARKDOWN_START\s*([\s\S]*?)\s*XIAOK_LOOP_MARKDOWN_END/gi;
  let match: RegExpExecArray | null;
  let selected: string | undefined;
  while ((match = blockRegex.exec(text)) !== null) {
    const content = match[1] ?? '';
    if (content.trim()) selected = decodeTextualToolValue(content);
  }
  if (selected) return selected;

  const lastStart = text.lastIndexOf(startMarker);
  if (lastStart < 0) return undefined;
  const afterStart = text.slice(lastStart + startMarker.length).trimEnd();
  for (let prefixLength = endMarker.length - 1; prefixLength >= 'XIAOK_LOOP'.length; prefixLength -= 1) {
    const clippedEndMarkerPrefix = endMarker.slice(0, prefixLength);
    if (!afterStart.endsWith(clippedEndMarkerPrefix)) continue;
    const content = afterStart.slice(0, -clippedEndMarkerPrefix.length).trimEnd();
    return content.trim() ? decodeTextualToolValue(content) : undefined;
  }
  return undefined;
}

function extractLastTextualWriteForPath(
  text: string,
  outputPath: string
): { content: string } | undefined {
  const targetPath = resolve(outputPath);
  const toolCallRegex = /<tool_call>\s*Write\b([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  let selected: { content: string } | undefined;

  while ((match = toolCallRegex.exec(text)) !== null) {
    const block = match[1] ?? '';
    const path = extractTextualWritePath(block);
    if (!path || resolve(path) !== targetPath) continue;
    const content = extractTextualWriteContent(block);
    if (!content || !content.trim()) continue;
    selected = { content: decodeTextualToolValue(content) };
  }

  return selected;
}

function extractTextualWritePath(block: string): string | undefined {
  const standard = /<arg_key>\s*(?:file_path|path)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i.exec(block);
  if (standard?.[1]) return decodeTextualToolValue(standard[1]).trim();

  const inline = /<arg_key>\s*(?:file_path|path)\s*=\s*([^<]+?)<\/arg_value>/i.exec(block);
  if (inline?.[1]) return decodeTextualToolValue(inline[1]).trim();

  return undefined;
}

function extractTextualWriteContent(block: string): string | undefined {
  const standard = /<arg_key>\s*(?:content|setContent)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i.exec(block);
  if (standard?.[1] !== undefined) return standard[1];

  const inline = /(?:content|setContent)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i.exec(block);
  if (inline?.[1] !== undefined) return inline[1];

  return undefined;
}

function decodeTextualToolValue(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function shouldMaterializeFailureDiagnostic(snapshot: TaskSnapshot, summary: string): boolean {
  if (snapshot.status !== 'failed') return false;
  if (summary.trim().length < 500) return false;
  if (snapshot.salvage?.reason?.includes('artifact evidence')) return true;
  return snapshot.events.some(event => {
    if (event.type === 'error') return event.message.includes('artifact evidence');
    if (event.type === 'progress') return event.message.includes('artifact evidence');
    return false;
  });
}

function buildFailureDiagnosticMarkdown(snapshot: TaskSnapshot, outputPath: string): string {
  const reason = snapshot.salvage?.reason ?? 'Task failed before producing artifact evidence.';
  const summary = snapshot.result?.summary?.trim() ?? 'No task summary was recorded.';
  return [
    '# Xiaok User Loop Failure Diagnostic',
    '',
    '## Status',
    `- Task ID: ${snapshot.taskId}`,
    `- Task Status: ${snapshot.status}`,
    `- Guard Reason: ${reason}`,
    `- Output Path: ${outputPath}`,
    '',
    '## What Happened',
    'The user loop task was blocked by the artifact evidence guard before it produced a recoverable Markdown handoff or a real file artifact. Xiaok materialized this diagnostic file so the loop card has a durable artifact to inspect instead of a bare failed run.',
    '',
    '## Captured Execution Summary',
    '',
    summary,
    '',
    '## Recommended Next Actions',
    '- Open the task snapshot and inspect the final assistant output for a missing Markdown handoff.',
    '- Re-run the loop after tightening the prompt or runner recovery path.',
    '- Keep the artifact evidence guard enabled; do not treat answer text alone as file evidence.',
    '',
  ].join('\n');
}

function outputPathForTemplate(template: UserLoopTemplate): string {
  return resolve(join(template.outputDirectory, template.outputFileName));
}

function taskStageSummary(snapshot: TaskSnapshot): string {
  if (snapshot.status === 'completed') return snapshot.result?.summary ?? 'Task completed.';
  return `Task ended with status ${snapshot.status}.`;
}

function recordFileArtifactCompletion(
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
    expectedKinds: ['file_artifact'],
    source: ownerKind === 'loop_stage' ? 'loop_stage_contract' : 'scheduler_executor_contract',
    confidence: 'explicit',
    metadata: { userLoopTemplate: true },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'file_artifact',
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
    source: ownerKind === 'loop_stage' ? 'loop_stage_contract' : 'scheduler_executor_contract',
    confidence: 'explicit',
    metadata: { userLoopTemplate: true },
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

function failRun(input: {
  loopStore: LoopStore;
  loopId: string;
  runId: string;
  failureKind: LoopRunFailureKind;
  message: string;
  now: number;
}): UserLoopTemplateRunResult {
  const failed = input.loopStore.finishLoopRunFailure(input.runId, input.failureKind, input.message, [], input.now);
  return { status: 'failed', run: failed ?? fallbackFailedRun(input.loopId, input.runId, { kind: 'unknown' }, input.now) };
}

function requireRun(run: LoopRun | undefined, loopStore: LoopStore, runId: string): LoopRun {
  const persisted = run ?? loopStore.getLoopRun(runId);
  if (!persisted) throw new Error(`Loop run missing after user loop completion: ${runId}`);
  return persisted;
}

function fallbackFailedRun(loopId: string, runId: string, trigger: LoopRunTrigger, now: number): LoopRun {
  return {
    id: runId,
    loopId,
    status: 'failed',
    trigger,
    evidenceIds: [],
    startedAt: now,
    finishedAt: now,
    updatedAt: now,
    failureKind: 'unknown',
    message: 'Loop run could not be loaded.',
  };
}
