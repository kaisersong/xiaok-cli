import type { RuntimeTurnRequest } from '../../ai/runtime/runtime-facade.js';
import type { MessageBlock, StreamChunk } from '../../types.js';
import type { RuntimeEvent } from '../events.js';
import type { RuntimeHooks } from '../hooks.js';
import type { TaskRunner, TaskRunnerInput } from './task-runtime-host.js';

interface RuntimeFacadeLike {
  runTurn(
    request: RuntimeTurnRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

interface CreateRuntimeFacadeTaskRunnerOptions {
  runtimeFacade: RuntimeFacadeLike;
  hooks: Pick<RuntimeHooks, 'onAny'>;
  cwd: string;
  source: RuntimeTurnRequest['source'];
  onChunk?: (chunk: StreamChunk) => void;
}

const MAX_QUEUED_ASSISTANT_DELTA_CHARS = 16 * 1024;

export function createRuntimeFacadeTaskRunner(options: CreateRuntimeFacadeTaskRunnerOptions): TaskRunner {
  return async (input: TaskRunnerInput): Promise<void> => {
    const queuedEvents: RuntimeEvent[] = [];
    let drainPromise: Promise<void> | null = null;
    let eventWriteError: unknown;
    const drainEvents = async (): Promise<void> => {
      while (queuedEvents.length > 0) {
        const event = queuedEvents.shift()!;
        try {
          await input.emitRuntimeEvent(event);
        } catch (error) {
          eventWriteError ??= error;
        }
      }
      drainPromise = null;
    };
    const enqueueEvent = (event: RuntimeEvent): void => {
      const previous = queuedEvents[queuedEvents.length - 1];
      if (
        previous?.type === 'assistant_delta'
        && event.type === 'assistant_delta'
        && canMergeAssistantDeltas(previous, event)
      ) {
        queuedEvents[queuedEvents.length - 1] = {
          ...previous,
          delta: previous.delta + event.delta,
        };
      } else {
        queuedEvents.push(event.type === 'assistant_delta' ? { ...event } : event);
      }
      drainPromise ??= drainEvents();
    };
    const unsubscribe = options.hooks.onAny((event) => {
      if (event.sessionId === input.sessionId) {
        enqueueEvent(event);
      }
    });

    let turnError: unknown;
    try {
      await options.runtimeFacade.runTurn({
        sessionId: input.sessionId,
        cwd: options.cwd,
        source: options.source,
        input: buildTaskRunnerInput(input),
      }, options.onChunk ?? (() => undefined), input.signal);
    } catch (error) {
      turnError = error;
    } finally {
      unsubscribe();
    }
    await drainPromise;
    if (turnError !== undefined) {
      throw turnError;
    }
    if (eventWriteError !== undefined) {
      throw eventWriteError;
    }
  };
}

function canMergeAssistantDeltas(
  previous: Extract<RuntimeEvent, { type: 'assistant_delta' }>,
  next: Extract<RuntimeEvent, { type: 'assistant_delta' }>,
): boolean {
  return previous.sessionId === next.sessionId
    && previous.turnId === next.turnId
    && previous.intentId === next.intentId
    && previous.stepId === next.stepId
    && previous.delta.length + next.delta.length <= MAX_QUEUED_ASSISTANT_DELTA_CHARS;
}

function buildTaskRunnerInput(input: TaskRunnerInput): MessageBlock[] {
  return [{
    type: 'text',
    text: [
      `任务目标：${input.prompt}`,
      `任务类型：${input.understanding.taskType}`,
      `预期交付物：${input.understanding.deliverable}`,
      `汇报对象：${input.understanding.audience}`,
      '材料：',
      ...input.materials.map((material) => (
        `- ${material.materialId} | ${material.originalName} | ${material.role} | ${material.parseStatus}`
      )),
    ].join('\n'),
  }];
}

export type { RuntimeEvent };
