import type { ChannelRequest } from './webhook.js';
interface DiscordMessagePayload {
    channel_id: string;
    id: string;
    author?: {
        id: string;
    };
    content?: string;
}
export declare function parseDiscordMessage(payload: DiscordMessagePayload): ChannelRequest;
export {};
