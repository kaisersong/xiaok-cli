import type { ToolExecutionContext } from '../../types.js';

const nativeReadonlyContexts = new WeakSet<object>();

/** Host dispatch narrows this invocation only; caller contexts are never marked. */
export function createNativeReadonlyExecutionContext(context?: ToolExecutionContext): ToolExecutionContext {
  const derived: ToolExecutionContext = context
    ? Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context))
    : {};
  nativeReadonlyContexts.add(derived);
  if (context && Object.isFrozen(context)) Object.freeze(derived);
  return derived;
}

/** Neither descriptor fields nor model input can mint the private role brand. */
export function isNativeReadonlyExecutionContext(context: unknown): boolean {
  return typeof context === 'object' && context !== null && nativeReadonlyContexts.has(context);
}

/** Audited wrappers preserve the role on a fresh bound context, never on callers. */
export function inheritNativeReadonlyExecutionContext(source: unknown, derived: ToolExecutionContext | undefined): ToolExecutionContext | undefined {
  if (derived && isNativeReadonlyExecutionContext(source)) nativeReadonlyContexts.add(derived);
  return derived;
}
