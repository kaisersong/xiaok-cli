import { resultFromTaskOutcome, toolDeclarationFromMcpTool } from '@modelcontextprotocol/ext-tasks/client';
import { toJsonValue } from '@modelcontextprotocol/ext-tasks/core';
import { callMcpToolWithSignal } from './transport.js';
/** One initiating call. Observation/reconnection never replays tools/call. */
export async function callMcpToolWithTasks(connection, params, options = {}) {
    if (!connection.tasks?.capabilities.execution)
        return callMcpToolWithSignal(connection.client, params, options);
    const normalized = toJsonValue(params.arguments);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized))
        throw new Error('invalid_mcp_tool_arguments');
    const execution = await connection.tasks.callTool(params.name, normalized, {
        signal: options.signal, requestTimeoutMs: options.timeout,
        ...(options.declaration ? { declaration: toolDeclarationFromMcpTool(options.declaration) } : {}),
    });
    let subscription;
    try {
        if (execution.kind === 'task') {
            const reference = execution.serializeReference();
            await options.observer?.handle(reference);
            if (options.detachOnTask && options.observer?.detached) {
                // The observer already committed the handle. Transfer observation;
                // returning this receipt says accepted, never says completed.
                await execution.handoff(() => { });
                await options.observer.detached(reference);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'accepted', taskId: reference.taskId, watchInConversation: true }) }],
                    structuredContent: { asyncTask: { status: 'accepted', taskId: reference.taskId } } };
            }
            if (reference.generation === 'v2') {
                try {
                    if (!connection.listenTaskEvents)
                        throw new Error('mcp_task_subscription_unsupported');
                    subscription = await connection.listenTaskEvents(connection.client, [reference.taskId], { timeout: options.timeout, signal: options.signal });
                    void subscription.closed.then(reason => {
                        if (reason !== 'local')
                            return options.observer?.unavailable?.(reference);
                    }).catch(() => { });
                }
                catch {
                    await options.observer?.unavailable?.(reference);
                }
            }
            const settlement = await execution.settle({ close: false, signal: options.signal, onEvent: event => options.observer?.event(reference, event) });
            return resultFromTaskOutcome(settlement.outcome);
        }
        const result = resultFromTaskOutcome((await execution.settle({ close: false, signal: options.signal })).outcome);
        await options.observer?.immediate?.();
        return result;
    }
    finally {
        await subscription?.close();
        await execution.detach();
    }
}
