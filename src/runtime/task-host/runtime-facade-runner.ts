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

export function createRuntimeFacadeTaskRunner(options: CreateRuntimeFacadeTaskRunnerOptions): TaskRunner {
  return async (input: TaskRunnerInput): Promise<void> => {
    const unsubscribe = options.hooks.onAny((event) => {
      if (event.sessionId === input.sessionId) {
        input.emitRuntimeEvent(event);
      }
    });

    try {
      await options.runtimeFacade.runTurn({
        sessionId: input.sessionId,
        cwd: options.cwd,
        source: options.source,
        input: buildTaskRunnerInput(input),
      }, options.onChunk ?? (() => undefined), input.signal);
    } finally {
      unsubscribe();
    }
  };
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
