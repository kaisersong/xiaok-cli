import { types } from 'node:util';
import { z } from 'zod';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { KNOWLEDGE_INPUT_SCHEMAS, KNOWLEDGE_OUTPUT_SCHEMAS, type KnowledgeMethod } from '../shared/knowledge-ipc-contract.js';

const methods = Object.keys(KNOWLEDGE_INPUT_SCHEMAS) as KnowledgeMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const effects: RiskTag[] = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'internal-mutation', 'network', 'exec', 'external-process'];
const readers = new Set<KnowledgeMethod>(['listCollections', 'listSources', 'getCollectionState', 'getSourceContent', 'search']);
export function captureKnowledgeOutput(method: KnowledgeMethod, raw: unknown): unknown {
  const error = readers.has(method) ? 'knowledge_projection_unavailable' : 'knowledge_operation_unknown';
  const snapshot = captureIpcData(raw, error);
  if (!KNOWLEDGE_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
  return snapshot;
}
type Producers = ReadonlyMap<string, IpcHandlerListener>;
const owners = new WeakMap<IpcHandleRegistrar, { producers: Producers | null; installed: Set<KnowledgeMethod>; registrar: IpcHandleRegistrar }>();

/** Fixed semantic channels; producers are private Main callbacks, never renderer input. */
export function registerKnowledgeIpc(ipc: IpcHandleRegistrar, rawProducers?: Producers): void {
  const producers = rawProducers ?? null;
  let owner = owners.get(ipc);
  if (owner && owner.producers !== producers) throw Error('knowledge_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!producers?.has(channel)) throw Error('knowledge_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { producers, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const channel = `desktop:kb:${method}`;
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'knowledge_input_invalid');
        if (!KNOWLEDGE_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('knowledge_input_invalid');
        return snapshot;
      }), output: KNOWLEDGE_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 21,
      sourceFile: 'desktop/electron/knowledge-typed-ipc.ts',
      // Any first DB access initializes/migrates and may schedule pending extraction.
      riskTags: method === 'pickFiles' ? ['dialog'] : [...effects],
      handler: async (args, event) => {
        const producer = producers?.get(channel);
        if (!producer) throw Error('knowledge_runtime_unavailable');
        const result = producer(event, ...args);
        if (!isPromise(result)) return captureKnowledgeOutput(method, result);
        const error = readers.has(method) ? 'knowledge_projection_unavailable' : 'knowledge_operation_unknown';
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => {
          try { resolve(captureKnowledgeOutput(method, value)); } catch (failure) { reject(failure); }
        }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
