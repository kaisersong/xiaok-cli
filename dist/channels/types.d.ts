export type ChannelName = 'slack' | 'telegram' | 'discord';
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
    messageId?: string;
}
export interface ChannelReplyTarget {
    chatId: string;
    threadId?: string;
    messageId?: string;
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
}
export interface ApprovalRequest extends ApprovalRequestInput {
    approvalId: string;
}
