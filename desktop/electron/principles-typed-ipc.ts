import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { types } from 'node:util';
import { z } from 'zod';
import type { PrinciplesStore } from './principles-store.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { PRINCIPLES_INPUT_SCHEMAS, PRINCIPLES_OUTPUT_SCHEMAS, type PrinciplesMethod, type PrincipleSaveInput } from '../shared/principles-ipc-contract.js';

type Store = Pick<PrinciplesStore, 'list' | 'save' | 'delete'>;
type Logger = (level: 'info', message: string, fields?: unknown) => void;
const methods = Object.keys(PRINCIPLES_INPUT_SCHEMAS) as PrinciplesMethod[];
const isPromise = types.isPromise, nativeThen = Promise.prototype.then, apply = Reflect.apply;

const mutationRisks: RiskTag[] = ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'internal-mutation'];
const owners = new WeakMap<IpcHandleRegistrar, { store: Store | null; log?: Logger; installed: Set<PrinciplesMethod>; registrar: IpcHandleRegistrar }>();

export function registerPrinciplesIpc(ipc: IpcHandleRegistrar, rawStore?: Store, log?: Logger): void {
  const store = rawStore ?? null;
  let owner = owners.get(ipc);
  if (owner && (owner.store !== store || owner.log !== log)) throw Error('principles_registrar_owner_conflict');
  if (!owner) {
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!store) throw Error('principles_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { store, log, installed: new Set(), registrar }; owners.set(ipc, owner);
  }
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    const error = method === 'listPrinciples' ? 'principles_projection_unavailable' : 'principles_operation_unknown';
    const capture = (value: unknown) => {
      const snapshot = captureIpcData(value, error);
      if (!PRINCIPLES_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
      return snapshot;
    };
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:${method}`,
      input: z.custom<unknown[]>(() => true).transform(raw => {
        const snapshot = captureIpcData(raw, 'principles_input_invalid');
        if (!PRINCIPLES_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('principles_input_invalid');
        return snapshot;
      }), output: PRINCIPLES_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 20,
      sourceFile: 'desktop/electron/principles-typed-ipc.ts', riskTags: method === 'listPrinciples' ? ['fs-read'] : [...mutationRisks],
      handler: async args => {
        if (!store) throw Error('principles_runtime_unavailable');
        log?.('info', method, method === 'savePrinciple' ? { id: (args[0] as PrincipleSaveInput).id } : method === 'deletePrinciple' ? { id: args[0] } : undefined);
        const result = method === 'listPrinciples' ? store.list()
          : method === 'savePrinciple' ? store.save(args[0] as PrincipleSaveInput, 'user') : store.delete(args[0] as string, 'user');
        const finish = (value: unknown) => {
          const snapshot = capture(value);
          if (method !== 'listPrinciples') log?.('info', `${method} result`, snapshot);
          return snapshot;
        };
        if (!isPromise(result)) return finish(result);
        assertStandardIpcPromise(result, error);
        return new Promise((resolve, reject) => apply(nativeThen, result, [(value: unknown) => { try { resolve(finish(value)); } catch (failure) { reject(failure); } }, reject]));
      },
    });
    owner.installed.add(method);
  }
}
