import type { RoomUiSnapshot } from '../../lib/desktop';

type Message = NonNullable<RoomUiSnapshot['messages']>[number];

export function roomMessageFoldKind(message: Message, messages: Map<string, Message>): 'scheduled' | 'reply' | 'event' | undefined {
  if (message.kind === 'workspace_event') return 'event';
  if (message.sender?.kind === 'system' && message.sourceRef?.kind === 'scheduled_task') return 'scheduled';
  if (message.sender?.kind !== 'agent') return;
  // Older broker completions lack replyToMessageId, but retain the exact wake source.
  const sourceId = message.replyToMessageId ?? (message.idempotencyKey?.startsWith('wake:') ? message.idempotencyKey.slice(5).split('|')[0] : undefined);
  const source = sourceId ? messages.get(sourceId) : undefined;
  if (source?.sender?.kind === 'system' && source.sourceRef?.kind === 'scheduled_task') return 'reply';
}
