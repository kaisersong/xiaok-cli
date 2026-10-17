import type { PermissionMode } from '../ai/permissions/manager.js';
export declare function isPermissionMode(value: unknown): value is PermissionMode;
export declare function loadLastPermissionMode(): PermissionMode | null;
/** Save at the user action, not shutdown: an older process must not overwrite a later choice. */
export declare function saveLastPermissionMode(mode: PermissionMode): void;
export declare function resolveInitialPermissionMode(options: {
    auto?: boolean;
    yolo?: boolean;
    interactive: boolean;
}, saved: PermissionMode | null): PermissionMode;
