import type { PermissionMode } from '../ai/permissions/manager.js';
import type { ReplRenderer } from './repl-renderer.js';
/** A local user choice; the caller applies it to the live permission manager. */
export declare function selectPermissionMode(current: PermissionMode, { renderer }: {
    renderer: ReplRenderer;
}): Promise<PermissionMode | null>;
