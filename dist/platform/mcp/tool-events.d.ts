import type { McpSubscription } from '@modelcontextprotocol/client';
import type { McpClientConnection } from './transport.js';
/** Call after installing the notification handler, before the initial catalog read. */
export declare function startMcpToolSubscription(connection: Pick<McpClientConnection, 'client' | 'protocolEra'>, options?: {
    timeout?: number;
    signal?: AbortSignal;
    onClosed?(reason: 'graceful' | 'remote'): void;
}): Promise<McpSubscription | undefined>;
