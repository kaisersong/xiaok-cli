export type CuaRuntimeFailureKind = 'authorization_denied' | 'session_ended' | 'transport_closed' | 'daemon_unreachable';
export interface CuaRuntimeFailure {
    kind: CuaRuntimeFailureKind;
    message: string;
}
/**
 * Classifies only failures that invalidate CUA authorization/session/transport
 * health. It is deliberately platform-neutral: this module is imported by the
 * cross-platform public wrapper and must never import macOS or driver bindings.
 */
export declare function classifyCuaRuntimeFailure(value: unknown): CuaRuntimeFailure | null;
/** Default-deny replay guard for calls whose first execution result is unknown. */
export declare function isReplaySafeCuaCall(operation: string, input: Readonly<Record<string, unknown>>): boolean;
