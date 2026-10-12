import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { PROJECT_PLANNING_INPUT, PROJECT_PLANNING_OUTPUT } from '../shared/project-planning-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const witness = new NativePromise<void>(resolve => resolve());
export function registerProjectPlanningIpc(ipc: IpcHandleRegistrar, producer: IpcHandlerListener): void {
  const capture = (raw: unknown) => {
    const snapshot = captureIpcData(raw, 'project_planning_projection_unavailable');
    if (!PROJECT_PLANNING_OUTPUT.safeParse(snapshot).success) throw Error('project_planning_projection_unavailable');
    return snapshot;
  };
  registerIpcHandler<unknown[], unknown>({ registrar: ipc, channel: 'desktop:kswarm:startProjectPlanning',
    payloadMode: 'tuple', rolloutRound: 37, riskTags: ['fs-write', 'network'], sourceFile: 'desktop/electron/project-planning-typed-ipc.ts',
    input: z.custom<unknown[]>(() => true).transform(raw => {
      const snapshot = captureIpcData(raw, 'project_planning_input_invalid');
      if (!z.tuple([PROJECT_PLANNING_INPUT]).safeParse(snapshot).success) throw Error('project_planning_input_invalid');
      return snapshot as unknown[];
    }), output: PROJECT_PLANNING_OUTPUT,
    handler: async (args, event) => {
      assertStandardIpcPromise(witness, 'project_planning_projection_unavailable');
      const result = producer(event, ...args);
      if (!types.isPromise(result)) return capture(result);
      assertStandardIpcPromise(result, 'project_planning_projection_unavailable');
      return new NativePromise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
        try { resolve(capture(value)); } catch (failure) { reject(failure); }
      }, reject]));
    }, captureOutput: capture,
  });
}
