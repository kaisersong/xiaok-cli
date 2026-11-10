import type { ToolExecutionContext } from '../../types.js';
import type { SearchScope } from './search-scope.mjs';
import { inheritNativeReadonlyExecutionContext } from './native-readonly-context.js';
const scopes = new WeakMap<object, SearchScope>();
/** Host wrapper only: scope never comes from model input or a context property. */
export function withSearchScope(context: ToolExecutionContext | undefined, scope: SearchScope): ToolExecutionContext {
  const bound: ToolExecutionContext = context
    ? Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)) : {};
  inheritNativeReadonlyExecutionContext(context, bound);
  scopes.set(bound, scope);
  return bound;
}
export function getSearchScope(context?: ToolExecutionContext): SearchScope | undefined {
  return context && scopes.get(context);
}
