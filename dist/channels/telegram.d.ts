import type { ChannelRequest } from './webhook.js';
interface TelegramUpdatePayload {
    message: {
        chat: {
            id: string | number;
        };
        from?: {
            id: string | number;
        };
        text?: string;
        message_id?: string | number;
        message_thread_id?: string | number;
    };
}
export declare function parseTelegramUpdate(payload: TelegramUpdatePayload): ChannelRequest;
export {};
