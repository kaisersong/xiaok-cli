import type { RoomCreateInput, RoomArchiveInput, RoomDeleteInput, RoomMembersInput, RoomSendInput, RoomSeenInput, RoomCancelInput, RoomProjectCreateInput, RoomTaskCreateInput, RoomListResultDto, RoomSnapshotDto, RoomCreateResultDto, RoomArchiveResultDto, RoomDeleteResultDto, RoomMembersResultDto, RoomSendResultDto, RoomSeenResultDto, RoomCancelResultDto, RoomProjectCreateResultDto, RoomTaskCreateResultDto } from '../../../shared/collaboration-room-ipc-contract.js';
/**
 * Renderer-side bridge for collaboration room APIs (design §12, §16.4).
 *
 * Thin semantic wrapper: the view layer never touches broker URLs, raw IPC
 * channels or room transport details — it calls these functions and renders
 * authoritative snapshots. Durable room state is owned by main + broker;
 * the renderer keeps only view state.
 */
import { getDesktopApi } from '../shared/desktop';

function requireDesktopApi() {
  const api = getDesktopApi();
  if (!api) throw new Error('desktop_api_unavailable');
  return api;
}

export type RoomUiSnapshot = RoomSnapshotDto;
export type RoomListResult = RoomListResultDto;

export type CollaborationRoomEvent =
  | { type: 'workspace_changed'; kind?: 'workspace_changed'; roomId: string }
  | {
      type: 'wake_settled';
      roomId: string;
      roomMessageId: string;
      logicalAgentId: string;
      outcome: 'completed' | 'failed';
      remaining: number;
    }
  | {
      type: 'discussion_settled';
      roomId: string;
      roomMessageId: string;
      completed: string[];
      failed: string[];
    };

export const desktop = {
  async listCollaborationRooms(): Promise<RoomListResult> {
    return requireDesktopApi().listCollaborationRooms() as Promise<RoomListResult>;
  },
  async getCollaborationRoom(roomId: string): Promise<RoomUiSnapshot> {
    return requireDesktopApi().getCollaborationRoom(roomId) as Promise<RoomUiSnapshot>;
  },
  async sendCollaborationRoomMessage(input: RoomSendInput): Promise<RoomSendResultDto> {
    return requireDesktopApi().sendCollaborationRoomMessage(input);
  },
  onCollaborationRoomEvent(listener: (event: CollaborationRoomEvent) => void): () => void {
    return requireDesktopApi().onCollaborationRoomEvent(listener as (event: unknown) => void);
  },
  async createCollaborationRoom(input: RoomCreateInput): Promise<RoomCreateResultDto> {
    return requireDesktopApi().createCollaborationRoom(input);
  },
  async deleteCollaborationRoom(input: RoomDeleteInput): Promise<RoomDeleteResultDto> {
    return requireDesktopApi().deleteCollaborationRoom(input);
  },
  async archiveCollaborationRoom(input: RoomArchiveInput): Promise<RoomArchiveResultDto> {
    return requireDesktopApi().archiveCollaborationRoom(input);
  },
  async updateCollaborationRoomMembers(input: RoomMembersInput): Promise<RoomMembersResultDto> {
    return requireDesktopApi().updateCollaborationRoomMembers(input);
  },
  async markCollaborationRoomSeen(input: RoomSeenInput): Promise<RoomSeenResultDto> {
    return requireDesktopApi().markCollaborationRoomSeen(input);
  },
  async createProjectFromRoom(input: RoomProjectCreateInput): Promise<RoomProjectCreateResultDto> {
    return requireDesktopApi().createProjectFromRoom(input);
  },
};
