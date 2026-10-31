import type { RuntimeTurnRequest } from '../../ai/runtime/runtime-facade.js';
import type { StreamChunk } from '../../types.js';
import type { RuntimeEvent } from '../events.js';
import type { RuntimeHooks } from '../hooks.js';
import type { TaskRunnerInput } from './task-runtime-host.js';
export interface LegacyRuntimeFacadeTaskRunnerInput extends Omit<TaskRunnerInput, 'history' | 'emitUsage' | 'emitRuntimeEvent'> {
    history?: undefined;
    emitUsage?: undefined;
    emitRuntimeEvent(event: RuntimeEvent): void | Promise<void>;
}
export type RuntimeFacadeTaskRunnerInput = TaskRunnerInput | LegacyRuntimeFacadeTaskRunnerInput;
export type RuntimeFacadeTaskRunner = (input: RuntimeFacadeTaskRunnerInput) => Promise<void>;
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
export declare function createRuntimeFacadeTaskRunner(options: CreateRuntimeFacadeTaskRunnerOptions): RuntimeFacadeTaskRunner;
export type { RuntimeEvent };
