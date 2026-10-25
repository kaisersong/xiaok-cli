import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { z } from 'zod';
import { types } from 'node:util';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import { ASSISTANT_INPUT_SCHEMAS, ASSISTANT_OUTPUT_SCHEMAS } from '../shared/assistant-ipc-contract.js';
import type { AssistantSemanticController } from './semantic-ipc.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';

const isPromise = types.isPromise, promiseThen = Promise.prototype.then, apply = Reflect.apply;

const channels = Object.freeze({
  getOverview: 'desktop:assistant:getOverview', activate: 'desktop:assistant:activate',
  pause: 'desktop:assistant:pause', resume: 'desktop:assistant:resume',
  acceptCandidate: 'desktop:assistant:acceptCandidate', rejectCandidate: 'desktop:assistant:rejectCandidate',
});
type Method = keyof typeof channels;
type Input = [] | [{ candidateId: string; collectionId?: string }];
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const deny = () => false;
const methods = new Map<string, Method>(Object.entries(channels).map(([method, channel]) => [channel, method as Method]));
type Owner = Readonly<{
  controller: AssistantSemanticController; authorize: (event: unknown) => boolean; registrar: IpcHandleRegistrar;
  installed: Set<Method>;
}>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
const localRisks: RiskTag[] = ['fs-read', 'fs-write-userData', 'internal-mutation'];
const risks: Record<Method, RiskTag[]> = {
  getOverview: [...localRisks, 'network', 'external-process', 'capability-token'],
  activate: [...localRisks], pause: [...localRisks], resume: [...localRisks], rejectCandidate: [...localRisks],
  acceptCandidate: [...localRisks, 'fs-write', 'network', 'external-process', 'capability-token', 'issues-token'],
};

/** Validate the old wire domain on the captured data; never recapture or return a JSON clone. */
function legacyInputDomain(value: unknown): void {
  const seen = new WeakSet<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 200000 || depth > 64) throw Error('loop_verification_execution_input');
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || seen.has(item)) throw Error('loop_verification_execution_input');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) visit(Object.getOwnPropertyDescriptor(item, key)!.value, depth + 1);
  }
  visit(value, 0);
  if (Buffer.byteLength(canonicalVerificationJson(value)) > 4 * 1024 ** 2) throw Error('loop_verification_execution_size');
}
function readId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('id_required');
  return value.trim();
}
function optionalId(value: unknown): string | undefined { return value === undefined ? undefined : readId(value); }
function admission(ipc: IpcHandleRegistrar, controller: AssistantSemanticController,
  authorize: (event: unknown) => boolean): Owner {
  const prior = owners.get(ipc);
  if (prior) {
    if (prior.controller !== controller || prior.authorize !== authorize) throw Error('assistant_ipc_registrar_owner_conflict');
    return prior;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    const method = methods.get(channel);
    if (!method) throw Error('assistant_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (authorize(event) !== true) throw Error('assistant_ipc_denied');
      if (args.length !== (method === 'acceptCandidate' || method === 'rejectCandidate' ? 1 : 0)) throw Error('assistant_ipc_input');
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ controller, authorize, registrar, installed: new Set<Method>() });
  owners.set(ipc, owner);
  return owner;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const value = captureIpcData(raw, 'assistant_ipc_input', captureOptions);
    if (method === 'acceptCandidate' || method === 'rejectCandidate') {
      const input = value[0]; legacyInputDomain(input);
      const fields = method === 'acceptCandidate' ? ['candidateId', 'collectionId'] : ['candidateId'];
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !fields.includes(key))) throw Error('assistant_ipc_input');
      readId(input.candidateId); if (method === 'acceptCandidate') optionalId(input.collectionId);
    }
    if (!ASSISTANT_INPUT_SCHEMAS[method].safeParse(value).success) throw Error('assistant_ipc_input');
    return value;
  });
}
export function registerAssistantTypedIpc(ipc: IpcHandleRegistrar, controller: AssistantSemanticController,
  authorize: (event: unknown) => boolean = deny): void {
  const owner = admission(ipc, controller, authorize);
  for (const [key, channel] of Object.entries(channels)) {
    const method = key as Method, output = ASSISTANT_OUTPUT_SCHEMAS[method];
    if (owner.installed.has(method)) continue;
    registerIpcHandler<Input, unknown>({ registrar: owner.registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/assistant-typed-ipc.ts', rolloutRound: 10, riskTags: [...risks[method]],
      handler: async input => {
        let result: unknown;
        if (method === 'acceptCandidate') result = controller.acceptCandidate({
          candidateId: readId(input[0]!.candidateId), collectionId: optionalId(input[0]!.collectionId), requestSource: 'user',
        });
        else if (method === 'rejectCandidate') result = controller.rejectCandidate({ candidateId: readId(input[0]!.candidateId), requestSource: 'user' });
        else if (method === 'getOverview') result = controller.getOverview();
        else result = controller[method]({ requestSource: 'user' });
        const snapshot = (value: unknown): unknown => {
          let captured: unknown;
          try { captured = captureIpcData(value, 'assistant_operation_unknown', captureOptions); }
          catch { throw Error('assistant_operation_unknown'); }
          if (!output.safeParse(captured).success) throw Error('assistant_operation_unknown');
          return captured;
        };
        // Capture synchronous producers before registry's await; use intrinsic
        // Promise.then so data objects' then accessors are never invoked.
        if (isPromise(result)) {
          assertStandardIpcPromise(result, 'assistant_operation_unknown');
          return apply(promiseThen, result, [snapshot]);
        }
        return snapshot(result);
      },
    });
    owner.installed.add(method);
  }
}
