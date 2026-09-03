import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAssistantRuntime,
  type AssistantRuntime,
} from '../../electron/assistant-runtime.js';
import { createLoopExecutionAdapter } from '../../electron/loop-execution-adapter.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { LoopStore } from '../../electron/loop-store.js';
import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
  DEFAULT_PERSONAL_ASSISTANT_ID,
} from '../../electron/assistant-types.js';

describe('assistant runtime wiring', () => {
  let rootDir: string;
  let loopStore: LoopStore;
  let evidenceStore: CompletionEvidenceStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-assistant-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    loopStore = new LoopStore(join(rootDir, 'loops.sqlite'));
    evidenceStore = new CompletionEvidenceStore(join(rootDir, 'evidence.sqlite'));
    loopStore.ensureBuiltInLoops(Date.UTC(2026, 7, 14, 0, 0));
    loopStore.setLoopStatus(ASSISTANT_EVENING_LOOP_ID, 'active', 1);
    loopStore.setLoopStatus(ASSISTANT_MORNING_LOOP_ID, 'active', 1);
    loopStore.ensureAssistantProfile({
      id: DEFAULT_PERSONAL_ASSISTANT_ID,
      status: 'active',
      locale: 'zh',
      timeZone: 'Asia/Shanghai',
      eveningTime: '22:30',
      morningTime: '08:30',
      workdays: [1, 2, 3, 4, 5],
      quietHours: { start: '23:00', end: '07:00' },
      dataScopes: ['tasks'],
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    evidenceStore.close();
    loopStore.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('routes the built-in evening loop through structured no-tool completion instead of the generic scanner', async () => {
    const now = Date.UTC(2026, 7, 14, 14, 30);
    const genericRunner = { runLoopNow: vi.fn() };
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        summary: '今天完成了发布验证。',
        candidates: [{
          kind: 'memory',
          title: '发布偏好',
          content: '发布前必须验证安装包。',
          scope: 'global',
          confidence: 0.9,
          evidenceRefs: [{ kind: 'task', id: 'task-1' }],
          dedupeKey: 'memory:release-verification',
        }],
      }),
    });
    const assistantRuntime = createRuntime({ now, complete });
    const runner = createLoopExecutionAdapter({ genericRunner, assistantRuntime });

    const result = await runner.runLoopNow(ASSISTANT_EVENING_LOOP_ID);

    expect(result).toMatchObject({ status: 'success' });
    expect(genericRunner.runLoopNow).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    const providerInput = complete.mock.calls[0][0] as Record<string, unknown>;
    expect(providerInput).toMatchObject({ model: 'fast', temperature: 0 });
    expect(providerInput).not.toHaveProperty('tools');
    expect(loopStore.listAssistantCandidates({ statuses: ['pending'] })).toEqual([
      expect.objectContaining({ title: '发布偏好', status: 'pending' }),
    ]);
  });

  it('uses the profile timezone and scheduled occurrence date as the exactly-once logical run key', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({ recommendations: [] }),
    });
    const assistantRuntime = createRuntime({
      now: Date.UTC(2026, 7, 15, 3, 0),
      complete,
    });
    const scheduledDueAt = Date.UTC(2026, 7, 14, 0, 30);
    const trigger = {
      kind: 'scheduled',
      timedActionId: 'assistant-morning',
      timedActionRunId: 'timed-run-1',
      scheduledDueAt,
      claimedAt: Date.UTC(2026, 7, 15, 3, 0),
      overdueMs: 95_400_000,
      recoveryReason: 'startup_recovery',
    };

    const first = await assistantRuntime.runLoopNow(ASSISTANT_MORNING_LOOP_ID, trigger);
    const second = await assistantRuntime.runLoopNow(ASSISTANT_MORNING_LOOP_ID, trigger);

    expect(first).toMatchObject({ status: 'success' });
    expect(second).toEqual({
      status: 'already_completed',
      completedRunId: expect.any(String),
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(loopStore.listLoopRuns(ASSISTANT_MORNING_LOOP_ID, 10)[0]).toMatchObject({
      trigger: {
        kind: 'assistant',
        source: 'scheduled',
        logicalRunKey: 'assistant:default-personal-assistant:morning:Asia/Shanghai:2026-08-14',
        scheduledDueAt,
      },
      logicalRunKey: 'assistant:default-personal-assistant:morning:Asia/Shanghai:2026-08-14',
    });
  });

  it('deduplicates manual runs by the profile-local calendar date', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({ summary: '完成。', candidates: [] }),
    });
    const assistantRuntime = createRuntime({
      now: Date.UTC(2026, 7, 14, 16, 30),
      complete,
    });

    const first = await assistantRuntime.runLoopNow(ASSISTANT_EVENING_LOOP_ID);
    const second = await assistantRuntime.runLoopNow(ASSISTANT_EVENING_LOOP_ID);

    expect(first).toMatchObject({ status: 'success' });
    expect(second).toMatchObject({ status: 'already_completed' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(loopStore.listLoopRuns(ASSISTANT_EVENING_LOOP_ID, 10)[0].logicalRunKey)
      .toBe('assistant:default-personal-assistant:evening:Asia/Shanghai:2026-08-15');
  });

  it('fails closed without publishing candidates when the provider is unavailable', async () => {
    const assistantRuntime = createRuntime({
      now: Date.UTC(2026, 7, 14, 14, 30),
      complete: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    });

    const result = await assistantRuntime.runLoopNow(ASSISTANT_EVENING_LOOP_ID);

    expect(result).toMatchObject({
      status: 'failed',
      run: expect.objectContaining({
        status: 'failed',
        failureKind: 'executor_failed',
        message: 'runtime_unavailable: provider unavailable',
      }),
    });
    expect(loopStore.listAssistantCandidates()).toEqual([]);
    expect(evidenceStore.listEvidenceForOwner('loop_run', result.status === 'failed' ? result.run.id : 'missing')).toEqual([]);
  });

  it('propagates the scheduler signal into assistant completion', async () => {
    const now = Date.UTC(2026, 7, 14, 14, 30);
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const complete = vi.fn((input: { signal?: AbortSignal }) => {
      capturedSignal = input.signal;
      return new Promise<{ text: string }>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      });
    });
    const assistantRuntime = createRuntime({ now, complete });

    const running = assistantRuntime.runLoopNow(ASSISTANT_EVENING_LOOP_ID, undefined, controller.signal);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    controller.abort(new Error('executor_timeout'));

    await expect(running).resolves.toMatchObject({
      status: 'failed',
      run: expect.objectContaining({ message: 'runtime_unavailable: executor_timeout' }),
    });
    expect(capturedSignal).toBe(controller.signal);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      queueTimeoutMs: 5 * 60_000,
      completionTimeoutMs: 60_000,
      signal: controller.signal,
    }));
  });

  it('delegates non-assistant loops to the existing generic runner', async () => {
    const genericResult = { status: 'skipped' as const, reason: 'missing_loop' as const };
    const genericRunner = { runLoopNow: vi.fn().mockResolvedValue(genericResult) };
    const assistantRuntime = { runLoopNow: vi.fn() } as unknown as AssistantRuntime;
    const runner = createLoopExecutionAdapter({ genericRunner, assistantRuntime });

    await expect(runner.runLoopNow('artifact-evidence-regression', { kind: 'manual' })).resolves.toBe(genericResult);
    expect(genericRunner.runLoopNow).toHaveBeenCalledWith('artifact-evidence-regression', { kind: 'manual' }, undefined);
    expect(assistantRuntime.runLoopNow).not.toHaveBeenCalled();
  });

  function createRuntime(input: {
    now: number;
    complete: ReturnType<typeof vi.fn>;
  }): AssistantRuntime {
    return createAssistantRuntime({
      loopStore,
      evidenceStore,
      now: () => input.now,
      collect: vi.fn().mockResolvedValue({
        from: input.now - 86_400_000,
        to: input.now,
        timeZone: 'Asia/Shanghai',
        items: [],
        dropped: {},
      }),
      llmPort: { complete: input.complete },
    });
  }
});
