import type { ToolExecutionContext } from '../../types.js';
import type { SearchScope } from './search-scope.mjs';
/** Host wrapper only: scope never comes from model input or a context property. */
export declare function withSearchScope(context: ToolExecutionContext | undefined, scope: SearchScope): ToolExecutionContext;
export declare function getSearchScope(context?: ToolExecutionContext): SearchScope | undefined;
