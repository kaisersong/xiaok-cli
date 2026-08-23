/**
 * `get_window_state` output parser with target binding (design v58 §6.1;
 * R47-02, R48-01, R49-02, R50-02).
 *
 * Two failure modes this closes:
 *
 *  1. A same-pid sibling window, or a stale/misrouted result, could satisfy the
 *     old checks and leak the wrong window's screenshot while still being marked
 *     `certified`. Target binding therefore happens *before* any screenshot,
 *     degraded classification, snapshot/token publication or runtime status
 *     update, and requires four safe-integer fields that agree with each other
 *     and with the request target.
 *  2. On mismatch the raw MCP result must not reach the model at all — not via
 *     text, summary, content, structuredContent, background_input, status, image
 *     data/paths, snapshot/token, or backend error/cause. The only public shape is
 *     a host constant, so a canary planted in any raw channel cannot escape.
 */
export declare const INVALID_IDENTITY_RESULT: Readonly<{
    ok: false;
    errorCode: "invalid_computer_use_output_identity";
    actionable: false;
}>;
export type IdentityRejectReason = 'missing' | 'type' | 'range' | 'mismatch';
export interface IdentityDiagnostic {
    readonly reason: IdentityRejectReason;
    readonly generationId: string;
    readonly traceId: string;
}
export type ParsedWindowState = {
    kind: 'ok';
    pid: number;
    windowId: number;
    elements: readonly unknown[];
    elementsComplete: boolean;
    snapshotId: string | null;
    screenshot: unknown;
} | {
    kind: 'ax_unresolved';
    pid: number;
    windowId: number;
    degradedReason: string;
    escalation: unknown;
    backgroundInput: unknown;
    elementsComplete: false;
    actionable: false;
    /** Observation-only screenshot, already proven to belong to the target. */
    screenshot: unknown;
} | {
    kind: 'invalid_identity';
    result: typeof INVALID_IDENTITY_RESULT;
    diagnostic: IdentityDiagnostic;
} | {
    kind: 'unsupported_degraded';
    pid: number;
    windowId: number;
    degradedReason: string;
};
export interface RequestTarget {
    readonly pid: number;
    readonly windowId: number;
}
export interface ParseContext {
    readonly generationId: string;
    readonly traceId: string;
}
/**
 * Parses a raw `get_window_state` MCP result. The caller must pass the target it
 * actually asked for; everything else is derived from the payload.
 */
export declare function parseWindowStateResult(raw: unknown, target: RequestTarget, context: ParseContext): ParsedWindowState;
export type SnapshotIdentityProjection = 'unknown' | 'certified' | 'blocked_external';
/**
 * Non-persistent runtime projection. It never writes `ComputerUsePreference`, and
 * a successful pixel action can never promote it.
 */
export declare function projectSnapshotIdentity(current: SnapshotIdentityProjection, parsed: ParsedWindowState): SnapshotIdentityProjection;
