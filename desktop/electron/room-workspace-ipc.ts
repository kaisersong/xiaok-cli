import type { RoomWorkspaceApi } from '../shared/room-workspace-contract.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { roomWorkspaceInputSchema, ROOM_WORKSPACE_OUTPUT_SCHEMAS,
  type RoomWorkspaceMethod, type RoomWorkspaceWireInput } from '../shared/room-workspace-ipc-contract.js';

export const ROOM_WORKSPACE_CHANNELS = Object.freeze({
  setCollaborationRoomLocalCommands: 'desktop:roomWorkspace:localCommands',
  getCollaborationRoomWorkspace: 'desktop:roomWorkspace:get',
  previewCollaborationRoomWorkspace: 'desktop:roomWorkspace:preview',
  commitCollaborationRoomWorkspace: 'desktop:roomWorkspace:commit',
  cancelCollaborationRoomWorkspaceChange: 'desktop:roomWorkspace:cancelChange',
  listCollaborationRoomWorkspaceFiles: 'desktop:roomWorkspace:listFiles',
  previewCollaborationRoomWorkspaceFile: 'desktop:roomWorkspace:previewFile',
  publishCollaborationRoomWorkspaceInstructions: 'desktop:roomWorkspace:publishInstructions',
  confirmCollaborationRoomWorkspaceArtifact: 'desktop:roomWorkspace:confirmArtifact',
  registerCollaborationRoomWorkspaceArtifact: 'desktop:roomWorkspace:registerArtifact',
  mapCollaborationRoomWorkspaceProject: 'desktop:roomWorkspace:mapProject',
  retryCollaborationRoomWorkspaceChange: 'desktop:roomWorkspace:retryChange',
} as const satisfies Record<keyof RoomWorkspaceApi, string>);

type Notify = (event: { type: 'workspace_changed'; kind: 'workspace_changed'; roomId: string }) => void;
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const isProxy = types.isProxy, ownDescriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const methodsByChannel = new Map<string, RoomWorkspaceMethod>(Object.entries(ROOM_WORKSPACE_CHANNELS)
  .map(([method, channel]) => [channel, method as RoomWorkspaceMethod]));
const mutations = new Set<RoomWorkspaceMethod>(Object.keys(ROOM_WORKSPACE_CHANNELS)
  .filter(method => !/^(get|preview|list)/.test(method)) as RoomWorkspaceMethod[]);
const adapters = new WeakMap<IpcHandleRegistrar, Readonly<{
  service: RoomWorkspaceApi; authorize: (event: unknown) => boolean; notify?: Notify; registrar: IpcHandleRegistrar;
}>>();
// Every call uses authenticated broker HTTP. Its first getHost may register an
// incarnation credential and fence an old host, even for a reader method.
const brokerRisks: RiskTag[] = ['network', 'internal-mutation', 'capability-token', 'issues-token'];
const changeRisks: RiskTag[] = [...brokerRisks, 'fs-read', 'fs-write', 'fs-write-userData', 'external-process'];
const riskTags: Record<RoomWorkspaceMethod, RiskTag[]> = {
  setCollaborationRoomLocalCommands: [...brokerRisks, 'fs-write-userData', 'external-process'],
  getCollaborationRoomWorkspace: [...brokerRisks, 'fs-read'],
  previewCollaborationRoomWorkspace: [...brokerRisks, 'fs-read', 'fs-write-userData'],
  commitCollaborationRoomWorkspace: [...changeRisks],
  cancelCollaborationRoomWorkspaceChange: [...brokerRisks, 'fs-write-userData'],
  listCollaborationRoomWorkspaceFiles: [...brokerRisks, 'fs-read'],
  previewCollaborationRoomWorkspaceFile: [...brokerRisks, 'fs-read'],
  publishCollaborationRoomWorkspaceInstructions: [...brokerRisks, 'fs-read', 'fs-write-userData'],
  confirmCollaborationRoomWorkspaceArtifact: [...brokerRisks, 'fs-read', 'fs-write-userData'],
  registerCollaborationRoomWorkspaceArtifact: [...brokerRisks, 'fs-read', 'fs-write-userData'],
  mapCollaborationRoomWorkspaceProject: [...brokerRisks, 'fs-read', 'fs-write-userData'],
  retryCollaborationRoomWorkspaceChange: [...changeRisks],
};
function notifyMutation(method: RoomWorkspaceMethod, roomId: string, notify?: Notify): void {
  if (mutations.has(method)) notify?.({ type: 'workspace_changed', kind: 'workspace_changed', roomId });
}
/** Only own data may identify an unknown operation; a proxy/accessor is not read. */
function operationId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || isProxy(value)) return undefined;
  const proto = prototype(value);
  if (proto !== objectPrototype && proto !== null) return undefined;
  const descriptor = ownDescriptor(value, 'operationId');
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}
function projectionFailure(method: RoomWorkspaceMethod, value: unknown): unknown {
  if (mutations.has(method)) {
    const id = operationId(value);
    return { ok: false, code: 'workspace_operation_unknown', ...(id === undefined ? {} : { operationId: id }) };
  }
  const error = { ok: false, code: 'workspace_projection_unavailable' };
  if (method === 'getCollaborationRoomWorkspace') return { ...error, phase: 'unavailable', revision: 0,
    permissions: { canManage: false, canRead: false }, claims: [], artifacts: [] };
  if (method === 'previewCollaborationRoomWorkspace') return { ...error, canCommit: false, changes: [], conflicts: [], overlaps: [] };
  if (method === 'listCollaborationRoomWorkspaceFiles') return { ...error, entries: [] };
  return error;
}
function admissionRegistrar(ipc: IpcHandleRegistrar, service: RoomWorkspaceApi,
  authorize: (event: unknown) => boolean, notify?: Notify): IpcHandleRegistrar {
  const prior = adapters.get(ipc);
  if (prior) {
    if (prior.service !== service || prior.authorize !== authorize || prior.notify !== notify)
      throw new Error('workspace_ipc_registrar_owner_conflict');
    return prior.registrar;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, typedHandler: IpcHandlerListener) {
    const method = methodsByChannel.get(channel);
    if (!method) throw new Error('workspace_ipc_channel_invalid');
    return ipc.handle(channel, async (event, ...rawArgs) => {
      if (!authorize(event)) return { ok: false, code: 'workspace_ipc_forbidden' };
      let input: unknown;
      try { input = captureIpcData(rawArgs[0], 'room_input_invalid', captureOptions); }
      catch { return { ok: false, code: 'room_input_invalid' }; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'room_input_invalid' };
      const room = ownDescriptor(input, 'roomId');
      if (!room || !('value' in room) || typeof room.value !== 'string') return { ok: false, code: 'room_input_invalid' };
      if (typeof service[method] !== 'function') return { ok: false, code: 'workspace_protocol_unavailable' };
      if (method === 'setCollaborationRoomLocalCommands') {
        const source = ownDescriptor(input, 'requestSource'), enabled = ownDescriptor(input, 'enabled');
        if (source?.value !== 'user' || typeof enabled?.value !== 'boolean') {
          notifyMutation(method, room.value, notify);
          return { ok: false, code: 'room_actor_forbidden' };
        }
      }
      return typedHandler(event, input);
    });
  } });
  adapters.set(ipc, Object.freeze({ service, authorize, notify, registrar }));
  return registrar;
}

export function registerRoomWorkspaceIpc(
  ipc: IpcHandleRegistrar, service: RoomWorkspaceApi, authorize: (event: unknown) => boolean,
  notify?: Notify,
) {
  const registrar = admissionRegistrar(ipc, service, authorize, notify);
  for (const [key, channel] of Object.entries(ROOM_WORKSPACE_CHANNELS)) {
    const method = key as RoomWorkspaceMethod, output = ROOM_WORKSPACE_OUTPUT_SCHEMAS[method];
    registerIpcHandler<RoomWorkspaceWireInput, unknown>({
      registrar, channel, input: roomWorkspaceInputSchema(method), output,
      sourceFile: 'desktop/electron/room-workspace-ipc.ts', rolloutRound: 6, riskTags: riskTags[method],
      inputError: () => ({ ok: false, code: 'room_input_invalid' }),
      handler: async input => {
        const fn = service[method] as (input: unknown) => Promise<unknown>;
        const result = await fn(input);
        let captured: unknown, failed = false;
        try { captured = captureIpcData(result, 'workspace_projection_unavailable', captureOptions); }
        catch { failed = true; }
        notifyMutation(method, input.roomId, notify);
        if (!failed && output.safeParse(captured).success) return captured;
        const fallback = projectionFailure(method, failed ? result : captured);
        output.parse(fallback);
        return fallback;
      },
    });
  }
}
