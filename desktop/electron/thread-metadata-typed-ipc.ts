import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import type { ThreadMetaStore, ThreadLabel, GtdLabel, ThreadMetaSnapshot, AppFlagKey } from './thread-meta-store.js';
import { THREAD_META_INPUT_SCHEMAS, THREAD_META_OUTPUT_SCHEMAS, THREAD_META_SNAPSHOT_SCHEMA,
  type ThreadMetadataMethod, type ThreadMetadataSnapshotDto } from '../shared/thread-metadata-ipc-contract.js';

type Store = Pick<ThreadMetaStore, 'getAll' | 'addThreadToLabel' | 'removeThreadFromLabel' | 'moveThread' | 'getFlag' | 'setFlag' | 'bulkImport'>;
type RequestSource = 'user' | 'agent' | 'scheduler';
type Broadcast = (snapshot: ThreadMetadataSnapshotDto) => void;
const isPromise = types.isPromise, then = Promise.prototype.then, apply = Reflect.apply;
const methods = Object.keys(THREAD_META_OUTPUT_SCHEMAS) as ThreadMetadataMethod[];
const readers = new Set<ThreadMetadataMethod>(['getThreadLabels', 'getAppFlag']);
function input(method: ThreadMetadataMethod, raw: unknown): unknown[] {
  const snapshot = captureIpcData(raw, 'thread_meta_input_invalid');
  if (!THREAD_META_INPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error('thread_meta_input_invalid');
  return snapshot as unknown[];
}
function output(method: ThreadMetadataMethod, raw: unknown): unknown {
  const error = readers.has(method) ? 'thread_meta_projection_unavailable' : 'thread_meta_operation_unknown';
  const snapshot = captureIpcData(raw, error);
  if (!THREAD_META_OUTPUT_SCHEMAS[method].safeParse(snapshot).success) throw Error(error);
  return snapshot;
}
function settle(value: unknown, capture: (value: unknown) => unknown, error: string): unknown {
  if (!isPromise(value)) return capture(value);
  assertStandardIpcPromise(value, error);
  return new Promise((resolve, reject) => {
    apply(then, value, [(result: unknown) => { try { resolve(capture(result)); } catch (error) { reject(error); } }, reject]);
  });
}

/** Fixed Main store and broadcaster. Source labels never come from a renderer payload. */
export function createThreadMetadataController(store: Store | null, broadcast: Broadcast | null) {
  const requireOwner = () => {
    if (!store || !broadcast) throw Error('thread_meta_runtime_unavailable');
    return { store, broadcast };
  };
  const read = (method: 'getThreadLabels' | 'getAppFlag', args: unknown[]) => {
    const owner = requireOwner(), values = input(method, args);
    const result = method === 'getThreadLabels' ? owner.store.getAll() : owner.store.getFlag(values[0] as AppFlagKey);
    return settle(result, value => output(method, value), 'thread_meta_projection_unavailable');
  };
  const write = (method: Exclude<ThreadMetadataMethod, 'getThreadLabels' | 'getAppFlag'>, args: unknown[], requestSource: RequestSource) => {
    if (requestSource !== 'user') throw Error('thread_meta_request_source_forbidden');
    const owner = requireOwner(), values = input(method, args);
    let result: unknown;
    switch (method) {
      case 'setThreadLabel': result = owner.store.addThreadToLabel(values[0] as string, values[1] as ThreadLabel); break;
      case 'unsetThreadLabel': result = owner.store.removeThreadFromLabel(values[0] as string, values[1] as ThreadLabel); break;
      case 'moveThreadLabel': result = owner.store.moveThread(values[0] as string, values[1] as GtdLabel, values[2] as GtdLabel); break;
      case 'setAppFlag': result = owner.store.setFlag(values[0] as AppFlagKey, values[1] as string); break;
      case 'migrateLegacyThreadMeta': result = owner.store.bulkImport(values[0] as ThreadMetaSnapshot); break;
    }
    return settle(result, value => {
      const receipt = output(method, value) as { ok: boolean };
      if (receipt.ok) {
        // This second projection follows the actual write. Bad projection means
        // the operation's result is unknown; it never means the write was undone.
        const snapshot = captureIpcData(owner.store.getAll(), 'thread_meta_operation_unknown');
        if (!THREAD_META_SNAPSHOT_SCHEMA.safeParse(snapshot).success) throw Error('thread_meta_operation_unknown');
        owner.broadcast(snapshot as ThreadMetadataSnapshotDto);
      }
      return receipt;
    }, 'thread_meta_operation_unknown');
  };
  return Object.freeze({
    getThreadLabels: () => read('getThreadLabels', []),
    getAppFlag: (key: unknown) => read('getAppFlag', [key]),
    setThreadLabel: (thread: unknown, label: unknown, requestSource: RequestSource) => write('setThreadLabel', [thread, label], requestSource),
    unsetThreadLabel: (thread: unknown, label: unknown, requestSource: RequestSource) => write('unsetThreadLabel', [thread, label], requestSource),
    moveThreadLabel: (thread: unknown, from: unknown, to: unknown, requestSource: RequestSource) => write('moveThreadLabel', [thread, from, to], requestSource),
    setAppFlag: (key: unknown, value: unknown, requestSource: RequestSource) => write('setAppFlag', [key, value], requestSource),
    migrateLegacyThreadMeta: (data: unknown, requestSource: RequestSource) => write('migrateLegacyThreadMeta', [data], requestSource),
  });
}
type Controller = ReturnType<typeof createThreadMetadataController>;
const owners = new WeakMap<IpcHandleRegistrar, { store: Store | null; broadcast: Broadcast | null; controller: Controller; registrar: IpcHandleRegistrar; installed: Set<ThreadMetadataMethod> }>();
export function registerThreadMetadataIpc(ipc: IpcHandleRegistrar, rawStore?: Store, rawBroadcast?: Broadcast): void {
  const store = rawStore ?? null, broadcast = rawBroadcast ?? null;
  let owner = owners.get(ipc);
  if (owner && (owner.store !== store || owner.broadcast !== broadcast)) throw Error('thread_meta_ipc_registrar_owner_conflict');
  if (!owner) {
    const controller = createThreadMetadataController(store, broadcast);
    const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!store || !broadcast) throw Error('thread_meta_runtime_unavailable');
        return listener(event, ...args);
      });
    } });
    owner = { store, broadcast, controller, registrar, installed: new Set() };
    owners.set(ipc, owner);
  }
  const controller = owner.controller;
  for (const method of methods) {
    if (owner.installed.has(method)) continue;
    registerIpcHandler<unknown[], unknown>({ registrar: owner.registrar, channel: `desktop:${method}`,
      input: z.custom<unknown[]>(() => true).transform(raw => input(method, raw)),
      output: THREAD_META_OUTPUT_SCHEMAS[method], payloadMode: 'tuple', rolloutRound: 15,
      sourceFile: 'desktop/electron/thread-metadata-typed-ipc.ts',
      riskTags: readers.has(method) ? ['fs-read'] : ['fs-read', 'fs-write-userData', 'internal-mutation'],
      handler: async args => {
        switch (method) {
          case 'getThreadLabels': return controller.getThreadLabels();
          case 'getAppFlag': return controller.getAppFlag(args[0]);
          case 'setThreadLabel': return controller.setThreadLabel(args[0], args[1], 'user');
          case 'unsetThreadLabel': return controller.unsetThreadLabel(args[0], args[1], 'user');
          case 'moveThreadLabel': return controller.moveThreadLabel(args[0], args[1], args[2], 'user');
          case 'setAppFlag': return controller.setAppFlag(args[0], args[1], 'user');
          case 'migrateLegacyThreadMeta': return controller.migrateLegacyThreadMeta(args[0], 'user');
        }
      },
    });
    owner.installed.add(method);
  }
}
