import { PermissionManager, type PermissionDecision, type PermissionMode } from './manager.js';
/** A task may narrow, never replace, the source registry permission authority. */
export declare class IntersectedPermissionManager extends PermissionManager {
    private readonly parent;
    constructor(parent: PermissionManager, mode: PermissionMode);
    getRevision(): number;
    onRevisionChanged(listener: (revision: number) => void): () => void;
    check(name: string, input: Record<string, unknown>): Promise<PermissionDecision>;
}
