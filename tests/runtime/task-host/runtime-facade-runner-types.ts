import type { RuntimeEvent } from '../../../src/runtime/events.js';
import type { TaskRunner, TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';
import type {
  RuntimeFacadeTaskRunner,
  RuntimeFacadeTaskRunnerInput,
  LegacyRuntimeFacadeTaskRunnerInput,
} from '../../../src/runtime/task-host/runtime-facade-runner.js';

type Assert<T extends true> = T;

export type AdapterRemainsHostAssignable = Assert<RuntimeFacadeTaskRunner extends TaskRunner ? true : false>;
export type FullHostInputStillAccepted = Assert<TaskRunnerInput extends RuntimeFacadeTaskRunnerInput ? true : false>;
export type FullHostHistoryStillRequired = Assert<{} extends Pick<TaskRunnerInput, 'history'> ? false : true>;
export type FullHostUsagePortStillRequired = Assert<{} extends Pick<TaskRunnerInput, 'emitUsage'> ? false : true>;
export type LocalSyncSinkAccepted = Assert<((event: RuntimeEvent) => void) extends LegacyRuntimeFacadeTaskRunnerInput['emitRuntimeEvent'] ? true : false>;
export type FullHostSyncSinkStillRejected = Assert<((event: RuntimeEvent) => void) extends TaskRunnerInput['emitRuntimeEvent'] ? false : true>;
export type LocalUnusedPortsMayBeAbsent = Assert<Omit<TaskRunnerInput, 'history' | 'emitUsage'> extends RuntimeFacadeTaskRunnerInput ? true : false>;
export type LocalEventSinkStillRequired = Assert<{} extends Pick<RuntimeFacadeTaskRunnerInput, 'emitRuntimeEvent'> ? false : true>;
export type MixedHistoryOnlyInputRejected = Assert<Omit<TaskRunnerInput, 'emitUsage'> extends RuntimeFacadeTaskRunnerInput ? false : true>;
export type MixedUsageOnlyInputRejected = Assert<Omit<TaskRunnerInput, 'history'> extends RuntimeFacadeTaskRunnerInput ? false : true>;
