export function createRuntimeHooks() {
    const handlers = new Map();
    const anyHandlers = new Set();
    return {
        on(type, handler) {
            const existing = handlers.get(type) ?? new Set();
            existing.add(handler);
            handlers.set(type, existing);
            return () => {
                existing.delete(handler);
                if (existing.size === 0) {
                    handlers.delete(type);
                }
            };
        },
        onAny(handler) {
            anyHandlers.add(handler);
            return () => {
                anyHandlers.delete(handler);
            };
        },
        emit(event) {
            const typedHandlers = handlers.get(event.type);
            if (typedHandlers) {
                for (const handler of typedHandlers) {
                    handler(event);
                }
            }
            for (const handler of anyHandlers) {
                handler(event);
            }
        },
    };
}
