/** Internal CLI resource owner. This port carries no ownership-release capability. */
export async function drainCliRegistryWriters(factory, compound) {
    const errors = [];
    // Factory descendants may still need the root compound journal to finish.
    // Even a rejected physical drain must settle before closing that journal.
    for (const operation of [() => factory.waitForDisposedResources(), () => compound?.dispose()]) {
        const [result] = await Promise.allSettled([Promise.resolve().then(operation)]);
        if (result.status === 'rejected')
            errors.push(result.reason);
    }
    if (errors.length)
        throw new AggregateError(errors, 'chat_registry_writers_unconfirmed');
}
/** Bounded finalization diagnostics. Never serialize SDK/request objects or
 * invoke callback-owned getters/toString while handling a cleanup failure. */
export function describeChatFinalizationFailures(error) {
    const messages = [], seen = new Set();
    const pending = [{ value: error, depth: 0 }];
    let nodes = 0, bytes = 0;
    while (pending.length && nodes++ < 32 && bytes < 16 * 1024) {
        const { value, depth } = pending.shift();
        if (seen.has(value))
            continue;
        seen.add(value);
        let message = 'cleanup failure diagnostic unavailable';
        try {
            if (value instanceof Error) {
                const name = Object.getOwnPropertyDescriptor(value, 'name');
                const text = Object.getOwnPropertyDescriptor(value, 'message');
                if (text && 'value' in text && typeof text.value === 'string') {
                    const label = name && 'value' in name && typeof name.value === 'string' ? name.value : 'Error';
                    message = `${label}: ${text.value}`;
                }
                if (value instanceof AggregateError && depth < 8) {
                    const children = Object.getOwnPropertyDescriptor(value, 'errors');
                    if (children && 'value' in children && Array.isArray(children.value)) {
                        // Inspect at most the first 32 original data slots; no iterator,
                        // inherited field, accessor, or arbitrary payload traversal.
                        for (let index = 0; index < 32 && pending.length + nodes < 32; index++) {
                            const slot = Object.getOwnPropertyDescriptor(children.value, String(index));
                            if (slot && 'value' in slot)
                                pending.push({ value: slot.value, depth: depth + 1 });
                        }
                    }
                }
            }
            else if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) {
                message = String(value);
            }
        }
        catch { /* Original cleanup error and release decision remain unchanged. */ }
        const remaining = 16 * 1024 - bytes;
        // Truncate UTF-8 on a character boundary before adding to the log payload.
        let bounded = '';
        for (const character of message) {
            const size = Buffer.byteLength(character, 'utf8');
            if (Buffer.byteLength(bounded, 'utf8') + size > remaining)
                break;
            bounded += character;
        }
        bytes += Buffer.byteLength(bounded, 'utf8');
        messages.push(bounded);
    }
    return messages;
}
