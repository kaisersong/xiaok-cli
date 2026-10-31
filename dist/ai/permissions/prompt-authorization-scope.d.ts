import type { PermissionChoice } from '../../types.js';
export interface PromptRememberPlan {
    applyRule(rule: string, apply: () => void): void;
    finish(persistenceFailed: boolean): void;
}
/** Internal host scope, never a tool argument, permission grant, or revision override. */
export interface PromptAuthorizationScope {
    begin(name: string, input: Record<string, unknown>, choice: Extract<PermissionChoice, {
        rule: string;
    }>): PromptRememberPlan;
    invalidate(): void;
}
/** Clone/freeze only data descriptors; do not execute approval/input getters. */
export declare function snapshotPromptData<T>(value: T): T;
export declare function withinPromptAuthorization<T>(scope: PromptAuthorizationScope, run: () => Promise<T>): Promise<T>;
export declare function isCurrentPromptAuthorization(scope: PromptAuthorizationScope): boolean;
/** An actual unowned mutation may target a manager with no pending transaction. */
export declare function invalidateCurrentPromptAuthorization(): void;
/** Snapshot before the terminal producer first reads choice.action. */
export declare function snapshotTerminalPromptChoice(choice: PermissionChoice): PermissionChoice | undefined;
/** Called only by the real terminal-choice producer, after its race has settled. */
export declare function capturePromptRememberChoice(name: string, input: Record<string, unknown>, choice: PermissionChoice | undefined): Promise<{
    choice: PermissionChoice | undefined;
    plan?: PromptRememberPlan;
}>;
