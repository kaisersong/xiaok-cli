import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { RUNTIME_RESUME_INPUT, RUNTIME_ACTION_OUTPUTS, type RuntimeActionMethod } from '../shared/runtime-actions-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
// Private fulfilled witness: descriptor qualification before creating producer promises.
const preProducerWitness = new NativePromise<void>(resolve => resolve());
type Source = 'user' | 'agent' | 'scheduler';
type Ops = { start(): unknown; stop(): unknown; restart(): unknown; resumeWorkflowRun(input: { projectId: string; workflowRunId: string }): unknown };
export function createDesktopRuntimeActionService(ops: Ops) {
  const authorize = (source: unknown) => { if (source !== 'user') throw Error('runtime_action_source_forbidden'); };
  const settle = (raw: unknown, method: RuntimeActionMethod) => {
    assertStandardIpcPromise(raw, 'runtime_action_projection_unavailable');
    return new NativePromise<unknown>((resolve, reject) => apply(nativeThen, raw, [(value: unknown) => {
      try { const data = captureIpcData(value, 'runtime_action_projection_unavailable'); if (!RUNTIME_ACTION_OUTPUTS[method].safeParse(data).success) throw Error('runtime_action_projection_unavailable'); resolve(data); }
      catch (error) { reject(error); }
    }, () => reject(Error('runtime_action_failed'))]));
  };
  const invoke = (operation: () => unknown, method: RuntimeActionMethod) => {
    assertStandardIpcPromise(preProducerWitness, 'runtime_action_projection_unavailable');
    let raw: unknown; try { raw = operation(); } catch { throw Error('runtime_action_failed'); }
    return settle(raw, method);
  };
  return {
    async start(source?: Source) { authorize(source); return invoke(() => ops.start(), 'start'); },
    async stop(source?: Source) { authorize(source); return invoke(() => ops.stop(), 'stop'); },
    async restart(source?: Source) { authorize(source); return invoke(() => ops.restart(), 'restart'); },
    async resumeWorkflowRun(input: unknown, source?: Source) {
      authorize(source); const data = captureIpcData(input, 'runtime_action_input_invalid');
      const parsed = RUNTIME_RESUME_INPUT.safeParse(data); if (!parsed.success) throw Error('runtime_action_input_invalid');
      return invoke(() => ops.resumeWorkflowRun(parsed.data), 'resumeWorkflowRun');
    },
  };
}
