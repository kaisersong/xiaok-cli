/** Wall time is display/preflight only. Actual execution permission always uses
 * the installed broker's continuous clock; this conversion grants nothing. */
export declare function qualificationDisplayDeadline(input: {
    originalWallSample: number;
    originalWallDeadline: number;
    currentWallSample: number;
    continuousRemainingMs: number;
}): number;
