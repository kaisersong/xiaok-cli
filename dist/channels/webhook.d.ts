import type { ChannelReplyTarget, ChannelSessionKey } from './types.js';
export interface ChannelRequest {
    sessionKey: ChannelSessionKey;
    message: string;
    replyTarget: ChannelReplyTarget;
}
