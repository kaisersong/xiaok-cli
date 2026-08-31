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

export interface RoomUiSnapshot {
  ok: boolean;
  code?: string;
  degraded?: boolean;
  room?: { roomId: string; title?: string; description?: string; status: string; revision?: number };
  members?: Array<{
    subject: { kind: 'user'; userId: string } | { kind: 'agent'; logicalAgentId: string };
    role: string;
    status: string;
  }>;
  messages?: Array<{
    messageId: string;
    text?: string;
    kind: string;
    sender?: { kind: string; userId?: string; logicalAgentId?: string; service?: string };
    roomSequence?: number;
    sourceRef?: {
      kind?: string;
      attachments?: Array<{ filePath: string; name: string }>;
      projectId?: string;
      projectRevision?: number;
      eventType?: string;
      projectionEventId?: string;
      taskId?: string;
      artifactId?: string;
      artifact?: {
        projectId?: string;
        filename?: string;
        kind?: string;
        mimeType?: string;
      };
    };
  }>;
  projects?: Array<{ id: string; name?: string; status?: string }>;
}

export interface RoomListResult {
  ok: boolean;
  code?: string;
  rooms?: Array<{ roomId: string; title: string; description?: string; status: string; updatedAt?: string }>;
}

export type CollaborationRoomEvent =
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
  async sendCollaborationRoomMessage(input: {
    roomId: string;
    text: string;
    filePaths: string[];
    idempotencyKey: string;
    replyToMessageId?: string;
    contextScope?: { kind: string; projectId?: string };
  }): Promise<unknown> {
    return requireDesktopApi().sendCollaborationRoomMessage(input);
  },
  onCollaborationRoomEvent(listener: (event: CollaborationRoomEvent) => void): () => void {
    return requireDesktopApi().onCollaborationRoomEvent(listener as (event: unknown) => void);
  },
  async createCollaborationRoom(input: unknown): Promise<unknown> {
    return requireDesktopApi().createCollaborationRoom(input);
  },
  async archiveCollaborationRoom(input: unknown): Promise<unknown> {
    return requireDesktopApi().archiveCollaborationRoom(input);
  },
  async updateCollaborationRoomMembers(input: unknown): Promise<unknown> {
    return requireDesktopApi().updateCollaborationRoomMembers(input);
  },
  async markCollaborationRoomSeen(input: unknown): Promise<unknown> {
    return requireDesktopApi().markCollaborationRoomSeen(input);
  },
  async createProjectFromRoom(input: unknown): Promise<unknown> {
    return requireDesktopApi().createProjectFromRoom(input);
  },
};
