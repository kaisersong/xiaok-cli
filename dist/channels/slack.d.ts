import type { ChannelRequest } from './webhook.js';
interface SlackEventPayload {
    event: {
        channel: string;
        thread_ts?: string;
        ts?: string;
        user?: string;
        text?: string;
    };
}
export declare function parseSlackEvent(payload: SlackEventPayload): ChannelRequest;
export {};
