import type { Tool } from '../../types.js';
import { ConnectorRegistry } from './connectors/registry.js';
import type { FetchProvider } from './connectors/fetch/types.js';
export interface WebFetchOptions {
    /** Legacy fetch override; kept so the existing tests keep working. */
    fetchFn?: typeof fetch;
    registry?: ConnectorRegistry;
    resolveProvider?: () => FetchProvider;
}
export declare function createWebFetchTool(options?: WebFetchOptions): Tool;
export declare const webFetchTool: Tool;
