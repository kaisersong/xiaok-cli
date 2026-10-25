const nativeReadonlyContexts = new WeakSet();
/** Host dispatch narrows this invocation only; caller contexts are never marked. */
export function createNativeReadonlyExecutionContext(context) {
    const derived = context
        ? Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context))
        : {};
    nativeReadonlyContexts.add(derived);
    if (context && Object.isFrozen(context))
        Object.freeze(derived);
    return derived;
}
/** Neither descriptor fields nor model input can mint the private role brand. */
export function isNativeReadonlyExecutionContext(context) {
    return typeof context === 'object' && context !== null && nativeReadonlyContexts.has(context);
}
/** Audited wrappers preserve the role on a fresh bound context, never on callers. */
export function inheritNativeReadonlyExecutionContext(source, derived) {
    if (derived && isNativeReadonlyExecutionContext(source))
        nativeReadonlyContexts.add(derived);
    return derived;
}
