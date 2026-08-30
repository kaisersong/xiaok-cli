interface RoomWakeBrokerPort {
  getRoomSnapshot(roomId: string): Promise<unknown>;
  claimWake(input: unknown): Promise<unknown>;
  completeWake(input: unknown): Promise<unknown>;
}

export interface CollaborationRoomTurnEnvelope {
  roomId: string;
  roomTitle: string;
  roomRevision: number;
  roomMessageId: string;
  logicalAgentId: string;
  contextScope: { kind: string; projectId?: string };
  messages: Array<{
    messageId: string;
    sender: unknown;
    kind: string;
    text?: string;
    replyToMessageId?: string;
    contextScope?: { kind: string; projectId?: string };
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createCollaborationRoomWakeDispatcher({
  brokerClient,
  execute,
  canExecute = async () => true,
}: {
  brokerClient: RoomWakeBrokerPort;
  execute(input: CollaborationRoomTurnEnvelope): Promise<{ text: string }>;
  canExecute?(logicalAgentId: string): Promise<boolean>;
}) {
  async function dispatchMessage(input: {
    roomId: string;
    roomMessageId: string;
    logicalAgentIds: string[];
  }) {
    const snapshot = await brokerClient.getRoomSnapshot(input.roomId);
    if (!isRecord(snapshot) || snapshot.ok === false || !isRecord(snapshot.room)) {
      return { ok: false, code: asString(snapshot && isRecord(snapshot) ? snapshot.code : '') || 'broker_unavailable' };
    }
    const room = snapshot.room;
    const roomMessages = Array.isArray(snapshot.messages)
      ? snapshot.messages.filter((message): message is Record<string, unknown> => (
          isRecord(message) && message.roomId === input.roomId
        ))
      : [];
    const source = roomMessages.find(message => message.messageId === input.roomMessageId);
    if (!source) return { ok: false, code: 'room_message_not_found' };

    const completed: string[] = [];
    const failed: string[] = [];
    for (const logicalAgentId of [...new Set(input.logicalAgentIds)].sort()) {
      if (!(await canExecute(logicalAgentId))) {
        failed.push(logicalAgentId);
        continue;
      }
      const claim = await brokerClient.claimWake({
        roomMessageId: input.roomMessageId,
        logicalAgentId,
        hostParticipantId: 'xiaok-desktop',
      });
      if (!isRecord(claim) || claim.ok === false || !asString(claim.claimToken)) {
        failed.push(logicalAgentId);
        continue;
      }
      try {
        const output = await execute({
          roomId: input.roomId,
          roomTitle: asString(room.title),
          roomRevision: Number(room.revision || 0),
          roomMessageId: input.roomMessageId,
          logicalAgentId,
          contextScope: isRecord(source.contextScope)
            ? source.contextScope as { kind: string; projectId?: string }
            : { kind: 'room_only' },
          messages: roomMessages.slice(-20).map(message => ({
            messageId: asString(message.messageId),
            sender: message.sender,
            kind: asString(message.kind),
            ...(asString(message.text) ? { text: asString(message.text) } : {}),
            ...(asString(message.replyToMessageId) ? { replyToMessageId: asString(message.replyToMessageId) } : {}),
            ...(isRecord(message.contextScope)
              ? { contextScope: message.contextScope as { kind: string; projectId?: string } }
              : {}),
          })),
        });
        const text = asString(output?.text).trim();
        const settled = await brokerClient.completeWake({
          claimToken: claim.claimToken,
          reply: text ? { kind: 'text', text } : { kind: 'pass' },
        });
        if (!isRecord(settled) || settled.ok === false) {
          failed.push(logicalAgentId);
          continue;
        }
        completed.push(logicalAgentId);
      } catch {
        failed.push(logicalAgentId);
      }
    }
    return { ok: true, completed, failed };
  }

  return { dispatchMessage };
}
