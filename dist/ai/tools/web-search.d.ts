import type { Tool } from '../../types.js';
import { ConnectorRegistry } from './connectors/registry.js';
import type { SearchProvider } from './connectors/search/types.js';
export interface WebSearchOptions {
    /** Legacy direct fetch override — kept for the existing tests that drive the
     * default DuckDuckGo provider via a mock fetch. New code should prefer
     * `registry`. */
    fetchFn?: typeof fetch;
    /** Provide a pre-built registry so the tool routes through configured providers. */
    registry?: ConnectorRegistry;
    /** Resolve provider snapshot per execute — for advanced wiring. */
    resolveProvider?: () => SearchProvider;
}
export declare function createWebSearchTool(options?: WebSearchOptions): Tool;
export declare const webSearchTool: Tool;
