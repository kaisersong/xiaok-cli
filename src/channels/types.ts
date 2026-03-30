export type ChannelName = 'slack' | 'telegram' | 'discord' | 'yzj';

export type ChannelMetadataValue = string | number | boolean | null;
export type ChannelMetadata = Record<string, ChannelMetadataValue>;

export interface ChannelSessionKey {
  channel: ChannelName;
  chatId: string;
  threadId?: string;
  userId?: string;
}

export interface ChannelSession {
  sessionId: string;
}

export interface ChannelAddress {
  channel: ChannelName;
  chatId: string;
  threadId?: string;
  userId?: string;
  messageId?: string;
  metadata?: ChannelMetadata;
}

export interface ChannelReplyTarget {
  chatId: string;
  threadId?: string;
  userId?: string;
  messageId?: string;
  metadata?: ChannelMetadata;
}

export interface OutboundChannelMessage {
  channel: ChannelName;
  target: ChannelReplyTarget;
  text: string;
  kind?: 'text' | 'status' | 'approval' | 'result';
  approvalId?: string;
}

export type ApprovalAction = 'approve' | 'deny';

export interface ApprovalRequestInput {
  sessionId: string;
  turnId: string;
  summary: string;
  taskId?: string;
  toolName?: string;
  timeoutMs?: number;
}

export interface ApprovalRequest extends ApprovalRequestInput {
  approvalId: string;
  createdAt: number;
  expiresAt: number;
}
