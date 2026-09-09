import type { RoomWorkspaceApi } from '../shared/room-workspace-contract.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';

export const ROOM_WORKSPACE_CHANNELS = {
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
} as const satisfies Record<keyof RoomWorkspaceApi, string>;

export function registerRoomWorkspaceIpc(
  ipc: IpcHandleRegistrar, service: RoomWorkspaceApi, authorize: (event: unknown) => boolean,
  notify?: (event: { type: 'workspace_changed'; kind: 'workspace_changed'; roomId: string }) => void,
) {
  for (const [method, channel] of Object.entries(ROOM_WORKSPACE_CHANNELS)) {
    ipc.handle(channel, async (event, input: unknown) => {
      if (!authorize(event)) return { ok: false, code: 'workspace_ipc_forbidden' };
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as { roomId?: unknown }).roomId !== 'string') return { ok: false, code: 'room_input_invalid' };
      const fn = service[method as keyof RoomWorkspaceApi] as (input: unknown) => Promise<{ ok: boolean }>;
      if (!fn) return { ok: false, code: 'workspace_protocol_unavailable' };
      const result = await fn(input);
      if (!/^(get|preview|list)/.test(method)) notify?.({ type: 'workspace_changed', kind: 'workspace_changed', roomId: (input as { roomId: string }).roomId });
      return result;
    });
  }
}
