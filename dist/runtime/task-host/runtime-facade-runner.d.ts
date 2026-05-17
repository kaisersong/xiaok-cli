import type { RuntimeTurnRequest } from '../../ai/runtime/runtime-facade.js';
import type { StreamChunk } from '../../types.js';
import type { RuntimeEvent } from '../events.js';
import type { RuntimeHooks } from '../hooks.js';
import type { TaskRunner } from './task-runtime-host.js';
interface RuntimeFacadeLike {
    runTurn(request: RuntimeTurnRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void>;
}
interface CreateRuntimeFacadeTaskRunnerOptions {
    runtimeFacade: RuntimeFacadeLike;
    hooks: Pick<RuntimeHooks, 'onAny'>;
    cwd: string;
    source: RuntimeTurnRequest['source'];
    onChunk?: (chunk: StreamChunk) => void;
}
export declare function createRuntimeFacadeTaskRunner(options: CreateRuntimeFacadeTaskRunnerOptions): TaskRunner;
export type { RuntimeEvent };
