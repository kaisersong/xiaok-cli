import type { Client, Transport, McpSubscription, RequestOptions } from '@modelcontextprotocol/client';
import { type JsonValue } from '@modelcontextprotocol/ext-tasks/core';
import type { DispatchOptions, JsonRpcResponse } from '@modelcontextprotocol/ext-tasks/client';
/** Shares the authenticated SDK transport without taking its request namespace.
 * Extension request/result decoding belongs to the official Tasks adapter. */
export declare class McpTaskRequestCoordinator {
    private readonly transport;
    private readonly prefix;
    private next;
    private closed;
    private captureListen?;
    private readonly taskHints;
    private readonly taskAcks;
    private readonly pending;
    constructor(transport: Transport);
    observeTaskStatus(taskId: string, changed: () => void): () => void;
    listenTasks(client: Pick<Client, 'listen'>, ids: string[], options?: RequestOptions): Promise<McpSubscription>;
    dispatch: (request: JsonValue, options?: DispatchOptions) => Promise<JsonRpcResponse>;
    dispose(): void;
}
