import { randomUUID } from 'node:crypto';
import { TaskStatusNotificationV2Schema, ErrorV2Schema, TaskSubscriptionAcknowledgedNotificationsV2Schema, contributeTaskFilterV2 } from '@modelcontextprotocol/ext-tasks/core/v2';
import { toJsonValue } from '@modelcontextprotocol/ext-tasks/core';
/** Shares the authenticated SDK transport without taking its request namespace.
 * Extension request/result decoding belongs to the official Tasks adapter. */
export class McpTaskRequestCoordinator {
    transport;
    prefix = `xiaok-task:${randomUUID()}:`;
    next = 0;
    closed = false;
    captureListen;
    taskHints = new Set();
    taskAcks = new Map();
    pending = new Map();
    constructor(transport) {
        this.transport = transport;
        const receive = transport.onmessage, close = transport.onclose;
        const send = transport.send.bind(transport);
        transport.send = (message, options) => {
            if ('method' in message && message.method === 'subscriptions/listen' && 'id' in message && typeof message.id === 'string')
                this.captureListen?.(message.id);
            return send(message, options);
        };
        transport.onmessage = (message, extra) => {
            if ('method' in message && message.method === 'notifications/tasks') {
                const parsed = TaskStatusNotificationV2Schema.safeParse(message);
                if (parsed.success)
                    for (const handler of this.taskHints) {
                        try {
                            handler(parsed.data.params.taskId);
                        }
                        catch { }
                    }
            }
            if ('method' in message && message.method === 'notifications/subscriptions/acknowledged') {
                const params = message.params;
                const metadata = params?._meta;
                const id = metadata?.['io.modelcontextprotocol/subscriptionId'];
                const parsed = TaskSubscriptionAcknowledgedNotificationsV2Schema.safeParse(params?.notifications);
                if (typeof id === 'string' && parsed.success && this.taskAcks.has(id))
                    this.taskAcks.set(id, parsed.data.taskIds ?? []);
            }
            if ('id' in message && typeof message.id === 'string' && message.id.startsWith(this.prefix) && !('method' in message)) {
                const request = this.pending.get(message.id);
                if (!request)
                    return; // Late response after timeout/detach is fenced.
                try {
                    if ('error' in message)
                        request.finish(undefined, { kind: 'error', error: ErrorV2Schema.parse(message.error) });
                    else
                        request.finish(undefined, { kind: 'result', result: toJsonValue(message.result) });
                }
                catch (error) {
                    request.finish(error);
                }
                return;
            }
            receive?.(message, extra);
        };
        transport.onclose = () => { this.dispose(); close?.(); };
    }
    observeTaskStatus(taskId, changed) {
        if (this.closed || this.taskHints.size >= 256)
            throw new Error('mcp_task_observation_capacity');
        const handler = (id) => { if (id === taskId)
            changed(); };
        this.taskHints.add(handler);
        return () => { this.taskHints.delete(handler); };
    }
    async listenTasks(client, ids, options) {
        let requestId;
        this.captureListen = id => { requestId = id; this.taskAcks.set(id, []); };
        let opening;
        try {
            opening = client.listen(contributeTaskFilterV2({}, ids).notifications, options);
        }
        finally {
            this.captureListen = undefined;
        }
        try {
            const subscription = await opening;
            // SDK 2.3 validates the base ACK but strips extension filter fields.
            // Verify the actual matching wire ACK using the official Tasks schema.
            const honored = requestId ? this.taskAcks.get(requestId) : undefined;
            if (!honored || ids.some(id => !honored.includes(id))) {
                await subscription.close();
                throw new Error('mcp_task_subscription_filter_refused');
            }
            void subscription.closed.finally(() => { if (requestId)
                this.taskAcks.delete(requestId); });
            return subscription;
        }
        catch (error) {
            if (requestId)
                this.taskAcks.delete(requestId);
            throw error;
        }
    }
    dispatch = (request, options) => {
        if (this.closed)
            return Promise.reject(new Error('mcp_task_connection_closed'));
        if (options?.signal?.aborted)
            return Promise.reject(options.signal.reason);
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.method !== 'string')
            return Promise.reject(new Error('invalid_mcp_task_request'));
        if (this.pending.size >= 256)
            return Promise.reject(new Error('mcp_task_request_capacity'));
        const id = `${this.prefix}${++this.next}`;
        const controller = new AbortController();
        return new Promise((resolve, reject) => {
            const abort = () => finish(options?.signal?.reason ?? new Error('mcp_task_request_aborted'));
            const timer = setTimeout(() => finish(new Error('mcp_task_request_timeout')), options?.context?.requestTimeoutMs ?? 120_000);
            const finish = (error, response) => {
                if (!this.pending.delete(id))
                    return;
                clearTimeout(timer);
                options?.signal?.removeEventListener('abort', abort);
                controller.abort();
                if (error !== undefined)
                    reject(error);
                else if (response)
                    resolve(response);
                else
                    reject(new Error('mcp_task_missing_response'));
            };
            this.pending.set(id, { finish });
            options?.signal?.addEventListener('abort', abort, { once: true });
            const message = { ...request, jsonrpc: '2.0', id };
            void this.transport.send(message, { requestSignal: controller.signal, headers: options?.context?.headers,
                onRequestStreamEnd: () => finish(new Error('mcp_task_request_stream_ended')) }).catch(finish);
        });
    };
    dispose() {
        if (this.closed)
            return;
        this.closed = true;
        this.taskAcks.clear();
        this.taskHints.clear();
        for (const request of [...this.pending.values()])
            request.finish(new Error('mcp_task_connection_closed'));
    }
}
