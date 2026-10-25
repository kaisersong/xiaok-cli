import { isDeepStrictEqual } from 'node:util';
const queries = new WeakMap();
/** Main factory only, on its actual final service query wrapper. This does not
 * classify a plugin descriptor or grant a new source, mutation, or execution. */
export function bindManagedCompoundQueryTool(tool, adapter) {
    if (queries.has(tool) || typeof adapter.assertCurrent !== 'function')
        throw Error('compound_managed_query_binding');
    const check = adapter.assertCurrent.bind(adapter);
    queries.set(tool, { execute: tool.execute, permission: tool.permission, definition: structuredClone(tool.definition), adapter: Object.freeze({ assertCurrent() { const result = check(); if (result !== undefined) {
                void Promise.resolve(result).catch(() => { });
                throw Error('compound_managed_query_async');
            } } }) });
    return tool;
}
export function getManagedCompoundQueryAdapter(tool) {
    const known = queries.get(tool);
    if (!known || known.execute !== tool.execute || known.permission !== tool.permission || !isDeepStrictEqual(known.definition, tool.definition))
        return undefined;
    return known.adapter;
}
const messages = new WeakMap();
/** Actual Main send wrapper only. The inspector must read its original durable
 * service operation, not accept a serialized model claim of delivery. */
export function bindManagedCompoundMessageTool(tool, adapter) {
    if (messages.has(tool) || typeof adapter.assertCurrent !== 'function' || typeof adapter.inspectCommittedResult !== 'function')
        throw Error('compound_managed_message_binding');
    const check = adapter.assertCurrent.bind(adapter), inspect = adapter.inspectCommittedResult.bind(adapter);
    const bound = Object.freeze({ assertCurrent() { const value = check(); if (value !== undefined) {
            void Promise.resolve(value).catch(() => { });
            throw Error('compound_managed_message_async');
        } }, inspectCommittedResult(input) {
            const value = inspect(Object.freeze({ nativeInvocationId: input.nativeInvocationId, finalInput: Object.freeze(structuredClone(input.finalInput)), result: input.result }));
            if (value && typeof value.then === 'function') {
                void Promise.resolve(value).catch(() => { });
                throw Error('compound_managed_message_async');
            }
            return Object.freeze(structuredClone(value));
        } });
    messages.set(tool, { execute: tool.execute, permission: tool.permission, definition: structuredClone(tool.definition), adapter: bound });
    return tool;
}
export function getManagedCompoundMessageAdapter(tool) {
    const known = messages.get(tool);
    if (!known || known.execute !== tool.execute || known.permission !== tool.permission || !isDeepStrictEqual(known.definition, tool.definition))
        return undefined;
    return known.adapter;
}
const cancellations = new WeakMap();
/** Main's exact existing-target cancellation scope, never a new-turn grant. */
export function bindManagedCompoundCancellationTool(tool, adapter) {
    if (cancellations.has(tool) || typeof adapter.assertCurrent !== 'function' || typeof adapter.prepareCancellation !== 'function' || typeof adapter.runCancellation !== 'function')
        throw Error('compound_managed_cancel_binding');
    const check = adapter.assertCurrent.bind(adapter), prepare = adapter.prepareCancellation.bind(adapter), run = adapter.runCancellation.bind(adapter);
    const bound = Object.freeze({ assertCurrent() { const value = check(); if (value !== undefined) {
            void Promise.resolve(value).catch(() => { });
            throw Error('compound_managed_cancel_async');
        } },
        prepareCancellation(input) { const value = prepare(Object.freeze({ nativeInvocationId: input.nativeInvocationId, finalInput: Object.freeze(structuredClone(input.finalInput)) })); if (value && typeof value.then === 'function') {
            void Promise.resolve(value).catch(() => { });
            throw Error('compound_managed_cancel_async');
        } return value; },
        runCancellation: run });
    cancellations.set(tool, { execute: tool.execute, permission: tool.permission, definition: structuredClone(tool.definition), adapter: bound });
    return tool;
}
export function getManagedCompoundCancellationAdapter(tool) {
    const known = cancellations.get(tool);
    if (!known || known.execute !== tool.execute || known.permission !== tool.permission || !isDeepStrictEqual(known.definition, tool.definition))
        return undefined;
    return known.adapter;
}
