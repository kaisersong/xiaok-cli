import {
  completeAssistantJson,
  validateEveningReflection,
  validateMorningBriefing,
} from './assistant-llm.js';
import {
  createAssistantLoopExecutor,
  type AssistantLoopExecutorDependencies,
} from './assistant-loop-executor.js';
import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
  DEFAULT_PERSONAL_ASSISTANT_ID,
  type AssistantProfile,
} from './assistant-types.js';
import type { CompletionEvidenceStore } from './completion-evidence-store.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import type { LoopRunner, RunLoopNowResult } from './loop-executor.js';
import type { LoopStore } from './loop-store.js';
import type { LoopRun, LoopRunTrigger } from './loop-types.js';

const EVENING_SYSTEM_PROMPT = `你是小K的晚间复盘助理。只根据输入快照返回 JSON，不得调用任何工具。
输出格式：{"summary":"...","candidates":[{"kind":"memory|knowledge|follow_up","title":"...","content":"...","scope":"global|project","projectId":"可选","confidence":0.0,"evidenceRefs":[{"kind":"...","id":"..."}],"dedupeKey":"..."}]}`;

const MORNING_SYSTEM_PROMPT = `你是小K的晨间建议助理。只根据输入快照返回 JSON，不得调用任何工具，最多给出三条建议。
输出格式：{"recommendations":[{"title":"...","reasonCode":"...","evidenceRefs":[{"kind":"...","id":"..."}]}]}`;

type AssistantKind = 'evening' | 'morning';

const ASSISTANT_LLM_QUEUE_TIMEOUT_MS = 5 * 60_000;
const ASSISTANT_LLM_COMPLETION_TIMEOUT_MS = 60_000;

export interface CreateAssistantRuntimeOptions {
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  llmPort: Pick<LoopLLMPort, 'complete'>;
  collect: AssistantLoopExecutorDependencies['collect'];
  now?: () => number;
  staleAfterMs?: number;
}

export type AssistantRuntime = LoopRunner;

export function createAssistantRuntime(options: CreateAssistantRuntimeOptions): AssistantRuntime {
  const now = options.now ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? 30 * 60_000;
  const executor = createAssistantLoopExecutor({
    getProfile: () => options.loopStore.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID),
    collect: options.collect,
    complete: async ({ kind, snapshot, signal }) => kind === 'evening'
      ? completeAssistantJson({
        port: options.llmPort,
        systemPrompt: EVENING_SYSTEM_PROMPT,
        snapshot,
        validate: validateEveningReflection,
        maxTokens: 3_000,
        queueTimeoutMs: ASSISTANT_LLM_QUEUE_TIMEOUT_MS,
        completionTimeoutMs: ASSISTANT_LLM_COMPLETION_TIMEOUT_MS,
        signal,
      })
      : completeAssistantJson({
        port: options.llmPort,
        systemPrompt: MORNING_SYSTEM_PROMPT,
        snapshot,
        validate: validateMorningBriefing,
        maxTokens: 1_200,
        queueTimeoutMs: ASSISTANT_LLM_QUEUE_TIMEOUT_MS,
        completionTimeoutMs: ASSISTANT_LLM_COMPLETION_TIMEOUT_MS,
        signal,
      }),
    stageCandidates: ({ runId, candidates, now: stagedAt }) => {
      options.loopStore.stageAssistantCandidates(runId, candidates, stagedAt);
    },
    recordEvidence: ({ runId, kind, summary, output, now: completedAt }) => {
      options.evidenceStore.upsertExpectation({
        ownerKind: 'loop_run',
        ownerId: runId,
        expectedKinds: ['log_diagnostic'],
        source: 'scheduler_executor_contract',
        confidence: 'explicit',
        metadata: { assistantContract: true, assistantKind: kind },
        now: completedAt,
      });
      options.evidenceStore.insertEvidence({
        ownerKind: 'loop_run',
        ownerId: runId,
        kind: 'log_diagnostic',
        summary,
        metadata: {
          assistantKind: kind,
          output,
          findings: [`assistant_${kind}_completed`],
        },
        now: completedAt,
      });
      return options.evidenceStore.completeOwnerWithEvidence({
        ownerKind: 'loop_run',
        ownerId: runId,
        now: completedAt,
      }).evidenceIds;
    },
    finishSuccess: ({ runId, evidenceIds, summary, now: completedAt }) => {
      options.loopStore.finishAssistantLoopRunSuccess(runId, evidenceIds, completedAt, summary);
    },
    finishFailure: ({ runId, failureKind, message, now: failedAt }) => {
      options.loopStore.finishLoopRunFailure(runId, failureKind, message, [], failedAt);
    },
  });

  return {
    async runLoopNow(loopId, trigger, signal) {
      const assistantKind = assistantKindForLoop(loopId);
      if (!assistantKind) return { status: 'skipped', reason: 'missing_loop' };
      const startedAt = now();
      const profile = options.loopStore.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID);
      if (!profile) return { status: 'skipped', reason: 'missing_loop' };
      if (profile.status !== 'active') return { status: 'skipped', reason: 'paused' };
      const recovery = options.loopStore.recoverStaleRuns(startedAt, staleAfterMs);
      if (!recovery.ok) throw new Error(`Loop stale-run recovery failed: ${recovery.error}`);
      const effectiveTrigger = assistantTrigger({
        assistantKind,
        profile,
        trigger,
        now: startedAt,
      });
      const begin = options.loopStore.beginLoopRun(loopId, effectiveTrigger, startedAt, staleAfterMs);
      if (begin.status !== 'started') return begin;

      await executor.execute({
        kind: assistantKind,
        runId: begin.run.id,
        now: startedAt,
        signal,
      });
      const persisted = options.loopStore.getLoopRun(begin.run.id) ?? begin.run;
      return resultFromRun(persisted);
    },
  };
}

function assistantKindForLoop(loopId: string): AssistantKind | undefined {
  if (loopId === ASSISTANT_EVENING_LOOP_ID) return 'evening';
  if (loopId === ASSISTANT_MORNING_LOOP_ID) return 'morning';
  return undefined;
}

function assistantTrigger(input: {
  assistantKind: AssistantKind;
  profile: AssistantProfile;
  trigger?: LoopRunTrigger;
  now: number;
}): LoopRunTrigger {
  const source = input.trigger?.kind === 'scheduled' ? 'scheduled' : 'manual';
  const occurrenceAt = source === 'scheduled' && typeof input.trigger?.scheduledDueAt === 'number'
    ? input.trigger.scheduledDueAt
    : input.now;
  const logicalRunKey = [
    'assistant',
    input.profile.id,
    input.assistantKind,
    input.profile.timeZone,
    localDate(occurrenceAt, input.profile.timeZone),
  ].join(':');
  return {
    ...(input.trigger ?? {}),
    kind: 'assistant',
    source,
    assistantKind: input.assistantKind,
    logicalRunKey,
  };
}

function localDate(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (kind: string) => parts.find(part => part.type === kind)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function resultFromRun(run: LoopRun): Extract<RunLoopNowResult, { run: LoopRun }> {
  if (run.status === 'success') return { status: 'success', run };
  if (run.status === 'blocked') return { status: 'blocked', run };
  return { status: 'failed', run };
}
