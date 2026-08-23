/**
 * CUA action contract table (design v58 §6.1; R25-01, R26-01, R28-03, R34-01,
 * R44-04, R50-01).
 *
 * Why a table instead of "map the tool name and pass the rest through": the real
 * `cua-driver 0.19.3` legacy catalog has 54 operations and contains **no**
 * standalone `screenshot` or `middle_click`, requires `from_x/from_y/to_x/to_y`
 * for drag, `amount` for scroll, integer identifiers, and per-operation required
 * fields that differ (`double_click`/`right_click` need `pid`; `set_value` needs
 * `pid` + `value`; `click` needs none). Generic pass-through produced "ready"
 * providers that then failed with Unknown tool / schema errors.
 *
 * One table drives both activation (exact-set ABI verification) and execution
 * (translation), so they can never drift.
 */
export type PublicCuaAction = 'capture' | 'screenshot' | 'list_apps' | 'list_windows' | 'click' | 'double_click' | 'right_click' | 'middle_click' | 'drag' | 'scroll' | 'type' | 'key' | 'set_value';
export interface CuaActionContract {
    readonly action: PublicCuaAction;
    readonly backendOperation: string;
    /** Backend fields this operation requires (exact set, per 0.19.3). */
    readonly backendRequired: readonly string[];
    /** Backend fields the translator may emit; the public reachable subset. */
    readonly translatorAllowed: readonly string[];
    /** Backend-only fields that must never be forwarded from public input. */
    readonly backendOnlyExcluded: readonly string[];
    /** Injected constants, e.g. include_screenshot / button:middle. */
    readonly forced?: Readonly<Record<string, unknown>>;
    /** Public → backend renames, e.g. x→from_x, pages→amount. */
    readonly renames?: Readonly<Record<string, string>>;
    /** Pixel coordinate pairs that must be provided together when present. */
    readonly pixelPairs?: readonly (readonly [string, string])[];
    readonly acceptsSnapshotTargeting: boolean;
}
export declare const CUA_ACTION_CONTRACTS: readonly CuaActionContract[];
/** Wrapper-only or compatibility fields that never reach the backend. */
export declare const WRAPPER_ONLY_FIELDS: readonly string[];
export declare class InvalidComputerUseInputError extends Error {
    readonly code = "invalid_computer_use_input";
    constructor(detail: string);
}
export declare function contractFor(action: string): CuaActionContract;
/**
 * Builds the backend payload from public input. It constructs a fresh object from
 * the allowed set — never "delete two keys and forward the rest".
 */
export declare function translateCuaAction(action: string, publicInput: Readonly<Record<string, unknown>>): {
    operation: string;
    input: Record<string, unknown>;
};
/** Activation-side ABI check against a real `tools/list` catalog. */
export interface BackendOperationSchema {
    readonly name: string;
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, {
        type?: string;
        enum?: readonly unknown[];
    }>>;
}
export type AbiVerification = {
    ok: true;
} | {
    ok: false;
    code: 'activation_failed';
    problems: readonly string[];
};
export declare function verifyBackendAbi(catalog: readonly BackendOperationSchema[]): AbiVerification;
