import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { z } from 'zod';
import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import type { CollaborationRoomSemanticController } from './semantic-ipc.js';
import { ROOM_SEMANTIC_INPUT_SCHEMAS, ROOM_SEMANTIC_OUTPUT_SCHEMAS,
  type RoomSemanticMethod, type RoomSemanticWireInput, type RoomCreateInput, type RoomArchiveInput,
  type RoomDeleteInput, type RoomMembersInput, type RoomSendInput, type RoomSeenInput,
  type RoomCancelInput, type RoomProjectCreateInput, type RoomTaskCreateInput,
} from '../shared/collaboration-room-ipc-contract.js';

export const ROOM_SEMANTIC_CHANNELS = Object.freeze({
  listRooms: 'desktop:collaborationRoom:listRooms', getRoom: 'desktop:collaborationRoom:getRoom',
  createRoom: 'desktop:collaborationRoom:createRoom', archiveRoom: 'desktop:collaborationRoom:archiveRoom',
  deleteRoom: 'desktop:collaborationRoom:deleteRoom', updateRoomMembers: 'desktop:collaborationRoom:updateMembers',
  sendMessage: 'desktop:collaborationRoom:sendMessage', markRoomSeen: 'desktop:collaborationRoom:markSeen',
  cancelDiscussion: 'desktop:collaborationRoom:cancelDiscussion', createProjectFromRoom: 'desktop:collaborationRoom:createProjectFromRoom',
  createTaskFromRoomMessage: 'desktop:collaborationRoom:createTaskFromRoomMessage',
});
const isPromise = types.isPromise, promiseThen = Promise.prototype.then, apply = Reflect.apply;
const denyDeletion = () => false;
const readers = new Set<RoomSemanticMethod>(['listRooms', 'getRoom']);
const methods = new Map<string, RoomSemanticMethod>(Object.entries(ROOM_SEMANTIC_CHANNELS)
  .map(([method, channel]) => [channel, method as RoomSemanticMethod]));
const common: RiskTag[] = ['network', 'fs-read', 'fs-write-userData', 'internal-mutation', 'capability-token'];
const physical: RiskTag[] = [...common, 'issues-token', 'exec', 'external-process', 'fs-write', 'fs-delete'];
const risk: Record<RoomSemanticMethod, RiskTag[]> = {
  listRooms: ['network', 'fs-read', 'capability-token'],
  getRoom: ['network', 'fs-read', 'capability-token', 'exec', 'external-process'],
  createRoom: [...common], archiveRoom: [...common], deleteRoom: [...physical], updateRoomMembers: [...common],
  sendMessage: [...physical], markRoomSeen: [...common], cancelDiscussion: [...physical],
  createProjectFromRoom: [...common, 'issues-token', 'fs-write', 'exec', 'external-process'],
  createTaskFromRoomMessage: [...common],
};
type Owner = Readonly<{ controller: CollaborationRoomSemanticController | null;
  authorizeDeletion: (event: unknown) => boolean; registrar: IpcHandleRegistrar; installed: Set<RoomSemanticMethod> }>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
function unavailable() { return { ok: false, code: 'broker_unavailable' }; }
function ownerFor(ipc: IpcHandleRegistrar, controller: CollaborationRoomSemanticController | null,
  authorizeDeletion: (event: unknown) => boolean): Owner {
  const prior = owners.get(ipc);
  if (prior) {
    if (prior.controller !== controller || prior.authorizeDeletion !== authorizeDeletion)
      throw Error('room_semantic_ipc_registrar_owner_conflict');
    return prior;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    const method = methods.get(channel);
    if (!method) throw Error('room_semantic_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      // Preserve the actual old forbidden/unavailable envelopes before touching wire data.
      if (method === 'deleteRoom' && authorizeDeletion(event) !== true) return { ok: false, code: 'room_actor_forbidden' };
      if (!controller || (method === 'deleteRoom' && !controller.deleteRoom)) return unavailable();
      const expected = method === 'listRooms' ? 0 : 1;
      if (args.length !== expected) return { ok: false, code: 'room_input_invalid' };
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ controller, authorizeDeletion, registrar, installed: new Set<RoomSemanticMethod>() });
  owners.set(ipc, owner); return owner;
}
function inputSchema(method: RoomSemanticMethod) {
  return z.custom<RoomSemanticWireInput>(() => true).transform(raw => {
    const captured = captureIpcData(raw, 'room_input_invalid');
    if (!ROOM_SEMANTIC_INPUT_SCHEMAS[method].safeParse(captured).success) throw Error('room_input_invalid');
    return captured;
  });
}
function captureResult(method: RoomSemanticMethod, value: unknown): unknown {
  const output = ROOM_SEMANTIC_OUTPUT_SCHEMAS[method];
  try {
    const captured = captureIpcData(value, 'room_projection_unavailable');
    if (output.safeParse(captured).success) return captured;
  } catch { /* No producer retry, rollback or physical cleanup is implied by a wire failure. */ }
  const failure = { ok: false, code: readers.has(method) ? 'room_projection_unavailable' : 'room_operation_unknown' };
  output.parse(failure); return failure;
}
export function registerCollaborationRoomTypedIpc(ipc: IpcHandleRegistrar,
  controller: CollaborationRoomSemanticController | null, authorizeDeletion: (event: unknown) => boolean = denyDeletion): void {
  const owner = ownerFor(ipc, controller, authorizeDeletion);
  for (const [key, channel] of Object.entries(ROOM_SEMANTIC_CHANNELS)) {
    const method = key as RoomSemanticMethod;
    if (owner.installed.has(method)) continue;
    registerIpcHandler<RoomSemanticWireInput, unknown>({ registrar: owner.registrar, channel,
      payloadMode: 'tuple', input: inputSchema(method), output: ROOM_SEMANTIC_OUTPUT_SCHEMAS[method],
      sourceFile: 'desktop/electron/collaboration-room-typed-ipc.ts', rolloutRound: 13, riskTags: [...risk[method]],
      inputError: () => ({ ok: false, code: 'room_input_invalid' }),
      handler: async tuple => {
        const room = owner.controller!; let result: unknown;
        switch (method) {
          case 'listRooms': result = room.listRooms(); break;
          case 'getRoom': result = room.getRoom(tuple[0] as string); break;
          case 'createRoom': result = room.createRoom(tuple[0] as RoomCreateInput); break;
          case 'archiveRoom': result = room.archiveRoom(tuple[0] as RoomArchiveInput); break;
          case 'deleteRoom': result = room.deleteRoom!(tuple[0] as RoomDeleteInput, { requestSource: 'user' }); break;
          case 'updateRoomMembers': result = room.updateRoomMembers(tuple[0] as RoomMembersInput); break;
          case 'sendMessage': result = room.sendMessage(tuple[0] as RoomSendInput); break;
          case 'markRoomSeen': result = room.markRoomSeen(tuple[0] as RoomSeenInput); break;
          case 'cancelDiscussion': result = room.cancelDiscussion(tuple[0] as RoomCancelInput); break;
          case 'createProjectFromRoom': result = room.createProjectFromRoom(tuple[0] as RoomProjectCreateInput); break;
          case 'createTaskFromRoomMessage': result = room.createTaskFromRoomMessage(tuple[0] as RoomTaskCreateInput); break;
        }
        // Capture synchronous output before the registry's await. Never inspect ordinary data.then.
        if (isPromise(result)) {
          const code = readers.has(method) ? 'room_projection_unavailable' : 'room_operation_unknown';
          try { assertStandardIpcPromise(result, code); } catch { return { ok: false, code }; }
          return apply(promiseThen, result, [(value: unknown) => captureResult(method, value)]);
        }
        return captureResult(method, result);
      },
    });
    owner.installed.add(method);
  }
}
