import type { YZJIncomingMessage } from './yzj-types.js';
import type { OutboundChannelMessage } from './types.js';
type InboundSource = 'webhook' | 'websocket';
/** serve 的统一入站入口，授权成功后才能创建会话或解析命令。 */
export declare function createYZJInboundProcessor(options: {
    allowedSenders?: string[];
    markSeen: (messageId: string) => boolean;
    deliver: (message: OutboundChannelMessage) => Promise<unknown>;
    execute: (message: YZJIncomingMessage, source: InboundSource) => Promise<unknown>;
    log: (message: string) => void;
}): (message: YZJIncomingMessage, source: InboundSource) => Promise<void>;
export {};
