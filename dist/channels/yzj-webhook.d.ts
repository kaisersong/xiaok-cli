import type { IncomingMessage, ServerResponse } from 'node:http';
import type { YZJIncomingMessage, YZJLogger } from './yzj-types.js';
export interface YZJWebhookHandlerOptions {
    path: string;
    secret?: string;
    logger?: YZJLogger;
    onMessage: (message: YZJIncomingMessage) => Promise<void> | void;
}
export declare function createYZJWebhookHandler(options: YZJWebhookHandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
