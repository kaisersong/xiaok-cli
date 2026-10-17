import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { types } from 'node:util';
import { z } from 'zod';
import type { DesktopLoopRuntime } from './loop-executor.js';
import type { CreateUserLoopTemplateInput } from './loop-types.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { LOOP_CREATE_TEMPLATE_INPUT_SCHEMA, LOOP_TEMPLATE_PATCH_SCHEMA, LOOP_MANAGEMENT_OUTPUT_SCHEMAS,
  type LoopManagementMethod, type LoopTemplatePatchDto } from '../shared/loop-management-ipc-contract.js';

type Runtime = Pick<DesktopLoopRuntime, 'loopStore' | 'runner' | 'listAnomalies'>;
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const methods = Object.keys(LOOP_MANAGEMENT_OUTPUT_SCHEMAS) as LoopManagementMethod[];
const readers = new Set<LoopManagementMethod>(['listDefinitions', 'listUserTemplates', 'listAnomalies', 'listConstraints']);
const owners = new WeakMap<IpcHandleRegistrar, { runtime: Runtime | null; registrar: IpcHandleRegistrar; installed: Set<LoopManagementMethod> }>();
const id = z.string();
const wire = {
  listDefinitions: z.tuple([]), listUserTemplates: z.tuple([]),
  createUserTemplate: z.tuple([LOOP_CREATE_TEMPLATE_INPUT_SCHEMA]),
  updateUserTemplate: z.tuple([id, z.union([LOOP_TEMPLATE_PATCH_SCHEMA, z.null()]).optional()]),
  deleteUserTemplate: z.tuple([id]), listAnomalies: z.tuple([id]), runNow: z.tuple([id]), listConstraints: z.tuple([id]),
  setConstraintActive: z.tuple([id, z.boolean()]), confirmConstraint: z.tuple([id]),
  clearRunHistory: z.tuple([id, z.array(z.string()).optional()]),
};
const writeRisks: RiskTag[] = ['fs-read', 'fs-write-userData', 'internal-mutation'];
// The actual Main runner may execute assistant models, TaskHost, publication,
// subprocesses and filesystem work. Metadata describes those effects, never a grant.
const runRisks: RiskTag[] = [...writeRisks, 'fs-write', 'fs-delete', 'exec', 'network', 'external-process', 'capability-token', 'issues-token'];
function requireRuntime(runtime: Runtime | null): Runtime {
  if (!runtime) throw Error('loop diagnostics runtime is not registered');
  return runtime;
}
function admission(ipc: IpcHandleRegistrar, rawRuntime: Runtime | undefined) {
  const runtime = rawRuntime ?? null, prior = owners.get(ipc);
  if (prior) {
    if (prior.runtime !== runtime) throw Error('loop_management_ipc_registrar_owner_conflict');
    return prior;
  }
  const installed = new Set<LoopManagementMethod>();
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    return ipc.handle(channel, (event, ...args) => {
      requireRuntime(runtime);
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ runtime, registrar, installed });
  owners.set(ipc, owner);
  return owner;
}
function inputSchema(method: LoopManagementMethod) {
  return z.custom<unknown[]>(() => true).transform(raw => {
    const input = captureIpcData(raw, 'loop_input_invalid');
    const expected = method === 'listDefinitions' || method === 'listUserTemplates' ? [0]
      : method === 'updateUserTemplate' || method === 'clearRunHistory' ? [1, 2]
      : method === 'setConstraintActive' ? [2] : [1];
    if (!expected.includes(input.length)) throw Error('loop_input_invalid');
    if (input.length && !['createUserTemplate', 'setConstraintActive', 'confirmConstraint'].includes(method)) readLoopId(input[0]);
    // Zod v3 requires tuple slots even when the last slot accepts undefined.
    // Validate an explicit missing optional slot without changing the wire snapshot.
    const checked = input.length === 1 && (method === 'updateUserTemplate' || method === 'clearRunHistory')
      ? [input[0], undefined] : input;
    if (!wire[method].safeParse(checked).success) throw Error('loop_input_invalid');
    return input;
  });
}
function invoke(runtime: Runtime, method: LoopManagementMethod, args: unknown[]): unknown {
  const store = runtime.loopStore;
  switch (method) {
    case 'listDefinitions': return store.listLoopDefinitions();
    case 'listUserTemplates': return store.listUserLoopTemplates();
    case 'createUserTemplate': return store.createUserLoopTemplate(readCreateUserLoopTemplateInput(args[0]));
    case 'updateUserTemplate': return store.updateUserLoopTemplate(args[0] as string, (args[1] ?? {}) as LoopTemplatePatchDto);
    case 'deleteUserTemplate': return store.deleteUserLoopTemplate(args[0] as string);
    case 'listAnomalies': return runtime.listAnomalies(args[0] as string);
    case 'runNow': return runtime.runner.runLoopNow(args[0] as string, undefined, undefined, { requestSource: 'user' });
    case 'listConstraints': return store.getConstraintsByLoopId(args[0] as string);
    case 'setConstraintActive': return store.setConstraintActive(args[0] as string, args[1] as boolean);
    case 'confirmConstraint': return store.confirmConstraint(args[0] as string);
    case 'clearRunHistory': return { ok: true, removed: store.clearLoopRunHistory(args[0] as string, args[1] as string[] | undefined) };
  }
}
export function registerLoopManagementIpc(ipc: IpcHandleRegistrar, runtime?: Runtime): void {
  const owner = admission(ipc, runtime);
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const output = LOOP_MANAGEMENT_OUTPUT_SCHEMAS[method];
    const error = readers.has(method) ? 'loop_projection_unavailable' : 'loop_operation_unknown';
    const capture = (result: unknown): unknown => {
      const snapshot = captureIpcData(result, error);
      if (!output.safeParse(snapshot).success) throw Error(error);
      return snapshot;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:loops:${method}`,
      payloadMode: 'tuple', input: inputSchema(method), output, rolloutRound: 14,
      sourceFile: 'desktop/electron/loop-management-typed-ipc.ts',
      riskTags: method === 'runNow' ? [...runRisks] : readers.has(method) ? ['fs-read'] : [...writeRisks],
      handler: async args => {
        const result = invoke(requireRuntime(owner.runtime), method, args);
        if (isPromise(result)) {
          assertStandardIpcPromise(result, error);
          return new Promise((resolve, reject) => {
            apply(nativeThen, result, [(value: unknown) => { try { resolve(capture(value)); } catch (failure) { reject(failure); } }, reject]);
          });
        }
        // Capture before this async function or the outer registry yields.
        return capture(result);
      },
    });
    owner.installed.add(method);
  }
}

function readLoopId(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error('loopId must be a non-empty string');
  return input;
}
function readCreateUserLoopTemplateInput(input: unknown): CreateUserLoopTemplateInput {
  if (!isRecord(input)) throw new Error('user loop template input must be an object');
  if (input.kind !== 'markdown_file' && input.kind !== 'task_completion') throw new Error('user loop template kind must be markdown_file or task_completion');
  const base = { loopId: readLoopId(input.loopId), title: readNonEmptyString(input.title, 'title'),
    description: typeof input.description === 'string' ? input.description : undefined,
    prompt: readNonEmptyString(input.prompt, 'prompt'), now: Date.now() };
  const result: CreateUserLoopTemplateInput = input.kind === 'task_completion' ? { ...base, kind: 'task_completion' }
    : { ...base, kind: 'markdown_file', outputDirectory: readNonEmptyString(input.outputDirectory, 'outputDirectory'),
      outputFileName: readNonEmptyString(input.outputFileName, 'outputFileName') };
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleEnabled')) result.scheduleEnabled = input.scheduleEnabled === true;
  if (isRecord(input.scheduleTrigger)) result.scheduleTrigger = input.scheduleTrigger;
  if (Object.prototype.hasOwnProperty.call(input, 'autoRunApproved')) result.autoRunApproved = input.autoRunApproved === true;
  return result;
}
function readNonEmptyString(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return input;
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
