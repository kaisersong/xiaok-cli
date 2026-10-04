import type { CuaConnection } from '../mcp/cua-connection-manager.js';
import type { McpToolSchema } from '../../ai/mcp/client.js';
import { type BackendOperationSchema, type CuaAbiProfile } from './cua-action-contract.js';
export declare const MACOS_TOKEN_CUA_ABI_PROFILE: CuaAbiProfile;
export declare function macosCuaCatalog(schemas: readonly McpToolSchema[]): BackendOperationSchema[];
export declare function selectMacosCuaAbiProfile(catalog: readonly BackendOperationSchema[]): CuaAbiProfile;
/** Applied to every initial/replacement connection, before any native input. */
export declare function createMacosCuaConnection(catalog: readonly BackendOperationSchema[], connection: CuaConnection): CuaConnection;
