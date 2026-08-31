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
  attachmentPaths: string[];
  messages: Array<{
    messageId: string;
    sender: unknown;
    kind: string;
    text?: string;
    replyToMessageId?: string;
    contextScope?: { kind: string; projectId?: string };
  }>;
}

export type CollaborationRoomDispatchEvent =
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
  onEvent,
}: {
  brokerClient: RoomWakeBrokerPort;
  execute(input: CollaborationRoomTurnEnvelope): Promise<{ text: string }>;
  canExecute?(logicalAgentId: string): Promise<boolean>;
  onEvent?(event: CollaborationRoomDispatchEvent): void | Promise<void>;
}) {
  async function emit(event: CollaborationRoomDispatchEvent): Promise<void> {
    try {
      await onEvent?.(event);
    } catch {
      // UI notification is best-effort and must not change durable wake state.
    }
  }

  async function dispatchMessage(input: {
    roomId: string;
    roomMessageId: string;
    logicalAgentIds: string[];
  }) {
    const logicalAgentIds = [...new Set(input.logicalAgentIds)].sort();
    const completed: string[] = [];
    const failed: string[] = [];
    const settleAgent = async (logicalAgentId: string, outcome: 'completed' | 'failed') => {
      (outcome === 'completed' ? completed : failed).push(logicalAgentId);
      await emit({
        type: 'wake_settled',
        roomId: input.roomId,
        roomMessageId: input.roomMessageId,
        logicalAgentId,
        outcome,
        remaining: Math.max(0, logicalAgentIds.length - completed.length - failed.length),
      });
    };
    const finish = async () => {
      await emit({
        type: 'discussion_settled',
        roomId: input.roomId,
        roomMessageId: input.roomMessageId,
        completed: [...completed],
        failed: [...failed],
      });
    };

    const snapshot = await brokerClient.getRoomSnapshot(input.roomId);
    if (!isRecord(snapshot) || snapshot.ok === false || !isRecord(snapshot.room)) {
      failed.push(...logicalAgentIds);
      await finish();
      return { ok: false, code: asString(snapshot && isRecord(snapshot) ? snapshot.code : '') || 'broker_unavailable' };
    }
    const room = snapshot.room;
    const roomMessages = Array.isArray(snapshot.messages)
      ? snapshot.messages.filter((message): message is Record<string, unknown> => (
          isRecord(message) && message.roomId === input.roomId
        ))
      : [];
    const source = roomMessages.find(message => message.messageId === input.roomMessageId);
    if (!source) {
      failed.push(...logicalAgentIds);
      await finish();
      return { ok: false, code: 'room_message_not_found' };
    }
    const sourceRef = isRecord(source.sourceRef) ? source.sourceRef : null;
    const attachmentPaths = sourceRef?.kind === 'user_attachments' && Array.isArray(sourceRef.attachments)
      ? sourceRef.attachments.flatMap((attachment) => (
          isRecord(attachment) && asString(attachment.filePath)
            ? [asString(attachment.filePath)]
            : []
        ))
      : [];

    for (const logicalAgentId of logicalAgentIds) {
      if (!(await canExecute(logicalAgentId))) {
        await settleAgent(logicalAgentId, 'failed');
        continue;
      }
      const claim = await brokerClient.claimWake({
        roomMessageId: input.roomMessageId,
        logicalAgentId,
        hostParticipantId: 'xiaok-desktop',
      });
      if (!isRecord(claim) || claim.ok === false || !asString(claim.claimToken)) {
        await settleAgent(logicalAgentId, 'failed');
        continue;
      }
      try {
        const output = await execute({
          roomId: input.roomId,
          roomTitle: asString(room.title),
          roomRevision: Number(room.revision || 0),
          roomMessageId: input.roomMessageId,
          logicalAgentId,
          attachmentPaths,
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
          await settleAgent(logicalAgentId, 'failed');
          continue;
        }
        await settleAgent(logicalAgentId, 'completed');
      } catch {
        await settleAgent(logicalAgentId, 'failed');
      }
    }
    await finish();
    return { ok: true, completed, failed };
  }

  return { dispatchMessage };
}
