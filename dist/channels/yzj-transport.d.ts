import type { ChannelDeliveryTransport } from './notifier.js';
import type { OutboundChannelMessage } from './types.js';
import type { YZJLogger } from './yzj-types.js';
export interface YZJTransportOptions {
    webhookUrl: string;
    logger?: YZJLogger;
    chunkLimit?: number;
    maxRetries?: number;
}
export interface YZJDeliveryResult {
    chunks: number;
    durationMs: number;
}
export declare class YZJTransportError extends Error {
    readonly status: number;
    readonly retryable: boolean;
    constructor(message: string, status: number, retryable: boolean);
}
export declare class YZJTransport implements ChannelDeliveryTransport {
    private readonly options;
    constructor(options: YZJTransportOptions);
    deliver(message: OutboundChannelMessage): Promise<void>;
    deliverWithMetrics(message: OutboundChannelMessage): Promise<YZJDeliveryResult>;
}
