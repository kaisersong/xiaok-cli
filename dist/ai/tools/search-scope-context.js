import { inheritNativeReadonlyExecutionContext } from './native-readonly-context.js';
const scopes = new WeakMap();
/** Host wrapper only: scope never comes from model input or a context property. */
export function withSearchScope(context, scope) {
    const bound = context
        ? Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)) : {};
    inheritNativeReadonlyExecutionContext(context, bound);
    scopes.set(bound, scope);
    return bound;
}
export function getSearchScope(context) {
    return context && scopes.get(context);
}
