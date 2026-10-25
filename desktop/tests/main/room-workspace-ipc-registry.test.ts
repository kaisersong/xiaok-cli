// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { registerRoomWorkspaceIpc, ROOM_WORKSPACE_CHANNELS } from '../../electron/room-workspace-ipc.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import type { RoomWorkspaceApi } from '../../shared/room-workspace-contract.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';

afterEach(() => resetIpcSchemaRegistryForTests());
function registrar() {
  const handlers = new Map<string, IpcHandlerListener>();
  const ipc = { handle: (channel: string, handler: IpcHandlerListener) => { handlers.set(channel, handler); } } as IpcHandleRegistrar;
  return { ipc, handlers };
}
const commit = ROOM_WORKSPACE_CHANNELS.commitCollaborationRoomWorkspace;
const validCommit = () => ({ roomId: 'room', previewId: 'preview', expectedRevision: 0,
  idempotencyKey: 'ORIGINAL', confirmOverlap: true, confirmSharedReadGrant: true });
const event = {} as Parameters<IpcHandlerListener>[0];
const broker = ['network', 'internal-mutation', 'capability-token', 'issues-token'];
const change = [...broker, 'fs-read', 'fs-write', 'fs-write-userData', 'external-process'];
const expectedRisks = {
  setCollaborationRoomLocalCommands: [...broker, 'fs-write-userData', 'external-process'],
  getCollaborationRoomWorkspace: [...broker, 'fs-read'],
  previewCollaborationRoomWorkspace: [...broker, 'fs-read', 'fs-write-userData'],
  commitCollaborationRoomWorkspace: change,
  cancelCollaborationRoomWorkspaceChange: [...broker, 'fs-write-userData'],
  listCollaborationRoomWorkspaceFiles: [...broker, 'fs-read'],
  previewCollaborationRoomWorkspaceFile: [...broker, 'fs-read'],
  publishCollaborationRoomWorkspaceInstructions: [...broker, 'fs-read', 'fs-write-userData'],
  confirmCollaborationRoomWorkspaceArtifact: [...broker, 'fs-read', 'fs-write-userData'],
  registerCollaborationRoomWorkspaceArtifact: [...broker, 'fs-read', 'fs-write-userData'],
  mapCollaborationRoomWorkspaceProject: [...broker, 'fs-read', 'fs-write-userData'],
  retryCollaborationRoomWorkspaceChange: change,
};
it('registers exactly the original twelve fixed channels with full broker and downstream effect metadata', () => {
  const { ipc, handlers } = registrar();
  registerRoomWorkspaceIpc(ipc, {} as unknown as RoomWorkspaceApi, () => false);
  expect(handlers.size).toBe(12);
  for (const [key, channel] of Object.entries(ROOM_WORKSPACE_CHANNELS)) {
    expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({ channel, rolloutRound: 6, payloadMode: 'single',
      sourceFile: 'desktop/electron/room-workspace-ipc.ts' });
    expect(IPC_SCHEMA_REGISTRY.get(channel)!.riskTags).toEqual(expectedRisks[key as keyof typeof expectedRisks]);
  }
});
it('rejects an untrusted frame before capturing any payload or notifying any sibling', async () => {
  const { ipc, handlers } = registrar(); let reads = 0;
  const payload = new Proxy({}, { get() { reads++; throw Error('must not read'); }, ownKeys() { reads++; throw Error('must not enumerate'); } });
  const notify = vi.fn(); registerRoomWorkspaceIpc(ipc, {} as unknown as RoomWorkspaceApi, () => false, notify);
  for (const handler of handlers.values()) expect(await handler(event, payload)).toEqual({ ok: false, code: 'workspace_ipc_forbidden' });
  expect(reads).toBe(0); expect(notify).not.toHaveBeenCalled();
});
it('preserves legacy bare-room delegation and returned-error notification but deliberately rejects present typed-malformed fields', async () => {
  const { ipc, handlers } = registrar(); const notify = vi.fn(), invoke = vi.fn(async () => ({ ok: false, code: 'workspace_mutation_owner_busy' }));
  registerRoomWorkspaceIpc(ipc, { commitCollaborationRoomWorkspace: invoke } as unknown as RoomWorkspaceApi, () => true, notify);
  expect(await handlers.get(commit)!(event, { roomId: 'room' })).toEqual({ ok: false, code: 'workspace_mutation_owner_busy' });
  expect(invoke).toHaveBeenCalledOnce(); expect(notify).toHaveBeenCalledOnce();
  expect(await handlers.get(commit)!(event, { roomId: 'room', expectedRevision: 'bad' })).toEqual({ ok: false, code: 'room_input_invalid' });
  expect(invoke).toHaveBeenCalledOnce(); expect(notify).toHaveBeenCalledOnce();
});
it.each([undefined, 'agent', 'scheduler', null])('retains local command source %s refusal before business schema and owner calls', async source => {
  const { ipc, handlers } = registrar(), invoke = vi.fn(), notify = vi.fn();
  registerRoomWorkspaceIpc(ipc, { setCollaborationRoomLocalCommands: invoke } as unknown as RoomWorkspaceApi, () => true, notify);
  expect(await handlers.get(ROOM_WORKSPACE_CHANNELS.setCollaborationRoomLocalCommands)!(event,
    { roomId: 'room', enabled: true, requestSource: source, bindingId: 42 })).toEqual({ ok: false, code: 'room_actor_forbidden' });
  expect(invoke).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledOnce();
});
it('captures input before an asynchronous owner can see later caller aliases', async () => {
  const { ipc, handlers } = registrar(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
  registerRoomWorkspaceIpc(ipc, { commitCollaborationRoomWorkspace: async (input: Parameters<NonNullable<RoomWorkspaceApi['commitCollaborationRoomWorkspace']>>[0]) => {
    enter(); await held; return { ok: true, operationId: input.idempotencyKey };
  } } as unknown as RoomWorkspaceApi, () => true);
  const input = validCommit(), work = handlers.get(commit)!(event, input); await entered;
  input.idempotencyKey = 'MUTATED'; release(); expect(await work).toEqual({ ok: true, operationId: 'ORIGINAL' });
});
it('captures output before notify, validates and returns that snapshot rather than the producer alias', async () => {
  const { ipc, handlers } = registrar(), output = { ok: true, operationId: 'ORIGINAL' };
  registerRoomWorkspaceIpc(ipc, { commitCollaborationRoomWorkspace: async () => output } as unknown as RoomWorkspaceApi,
    () => true, () => { output.operationId = 'MUTATED'; });
  const value = await handlers.get(commit)!(event, validCommit());
  expect(value).not.toBe(output); expect(value).toEqual({ ok: true, operationId: 'ORIGINAL' });
});
it('returns unknown after an entered mutation output violation, retaining only an own safe operation id and original notify', async () => {
  const { ipc, handlers } = registrar(); let getters = 0, calls = 0; const notify = vi.fn();
  const output = { ok: true, operationId: 'committed-operation' };
  Object.defineProperty(output, 'bad', { enumerable: true, get() { getters++; return 'must not execute'; } });
  registerRoomWorkspaceIpc(ipc, { commitCollaborationRoomWorkspace: async () => { calls++; return output; } } as unknown as RoomWorkspaceApi,
    () => true, notify);
  expect(await handlers.get(commit)!(event, validCommit())).toEqual({ ok: false, code: 'workspace_operation_unknown', operationId: 'committed-operation' });
  expect(getters).toBe(0); expect(calls).toBe(1); expect(notify).toHaveBeenCalledOnce();
});
it('never uses an operationId accessor or Proxy as an unknown-operation locator', async () => {
  for (const kind of ['accessor', 'proxy']) {
    const { ipc, handlers } = registrar(); let reads = 0;
    let output: object = { ok: true };
    if (kind === 'accessor') Object.defineProperty(output, 'operationId', { enumerable: true, get() { reads++; return 'unsafe'; } });
    else output = new Proxy(output, { get(target, key) { if (key === 'operationId') { reads++; return 'unsafe'; }
      return Reflect.get(target, key); }, getOwnPropertyDescriptor() { reads++; throw Error('unsafe descriptor'); } });
    registerRoomWorkspaceIpc(ipc, { commitCollaborationRoomWorkspace: async () => output } as unknown as RoomWorkspaceApi, () => true);
    expect(await handlers.get(commit)!(event, validCommit())).toEqual({ ok: false, code: 'workspace_operation_unknown' });
    expect(reads).toBe(0);
  }
});
it('keeps the first authorizer immutable after failed different-owner and same-owner duplicate registration', async () => {
  const { ipc, handlers } = registrar(), service = {} as unknown as RoomWorkspaceApi, authorize = () => false;
  registerRoomWorkspaceIpc(ipc, service, authorize); const original = handlers.get(commit);
  expect(() => registerRoomWorkspaceIpc(ipc, service, () => true)).toThrow('workspace_ipc_registrar_owner_conflict');
  expect(() => registerRoomWorkspaceIpc(ipc, service, authorize)).toThrow('registered twice');
  expect(handlers.get(commit)).toBe(original);
  expect(await original!(event, validCommit())).toEqual({ ok: false, code: 'workspace_ipc_forbidden' });
});
it('retains a partially registered first owner after registrar failure without substituting a later authorizer', async () => {
  const handlers = new Map<string, IpcHandlerListener>(); let count = 0;
  const ipc = { handle(channel: string, handler: IpcHandlerListener) {
    if (++count === 2) throw Error('registrar failure'); handlers.set(channel, handler);
  } } as IpcHandleRegistrar;
  const service = {} as unknown as RoomWorkspaceApi;
  expect(() => registerRoomWorkspaceIpc(ipc, service, () => false)).toThrow('registrar failure');
  expect(() => registerRoomWorkspaceIpc(ipc, service, () => true)).toThrow('workspace_ipc_registrar_owner_conflict');
  expect(handlers.size).toBe(1);
  expect(await [...handlers.values()][0]!(event, {})).toEqual({ ok: false, code: 'workspace_ipc_forbidden' });
});
it('keeps a zero-registration failed attempt fenced to its first owner until a fresh registrar is used', () => {
  const ipc = { handle() { throw Error('first handle rejected'); } } as IpcHandleRegistrar;
  const service = {} as unknown as RoomWorkspaceApi;
  expect(() => registerRoomWorkspaceIpc(ipc, service, () => false)).toThrow('first handle rejected');
  expect(IPC_SCHEMA_REGISTRY.size).toBe(0);
  expect(() => registerRoomWorkspaceIpc(ipc, service, () => true)).toThrow('workspace_ipc_registrar_owner_conflict');
});
