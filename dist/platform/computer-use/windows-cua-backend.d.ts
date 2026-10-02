import type { ComputerUseBackend } from '../../ai/tools/computer-use.js';
import type { CuaConnectionManager } from '../mcp/cua-connection-manager.js';
export declare function isWindowsCuaReplaySafeCall(operation: string, input: Readonly<Record<string, unknown>>): boolean;
export declare function createWindowsCuaBackend(manager: CuaConnectionManager, options?: {
    onObserved?: () => void;
}): ComputerUseBackend;
