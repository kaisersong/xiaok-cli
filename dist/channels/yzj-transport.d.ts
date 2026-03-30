import type { ChannelDeliveryTransport } from './notifier.js';
import type { OutboundChannelMessage } from './types.js';
import type { YZJLogger } from './yzj-types.js';
export interface YZJTransportOptions {
    sendMsgUrl: string;
    logger?: YZJLogger;
    chunkLimit?: number;
}
export interface YZJDeliveryResult {
    chunks: number;
    durationMs: number;
}
export declare class YZJTransport implements ChannelDeliveryTransport {
    private readonly options;
    constructor(options: YZJTransportOptions);
    deliver(message: OutboundChannelMessage): Promise<void>;
    deliverWithMetrics(message: OutboundChannelMessage): Promise<YZJDeliveryResult>;
}
