import type { CapturedGroupsRow } from './captured-sqlite-groups-row.js';
export interface CapturedGroupsReference {
    readonly namespace: string;
    readonly id: string;
    readonly path: string;
}
/** Historical typed declarations only. No current identity/ownership inference. */
export declare function declareCapturedGroupsRow(row: CapturedGroupsRow): Readonly<{
    references: readonly CapturedGroupsReference[];
    unmapped: readonly string[];
    observationDeclarations: readonly Readonly<{
        path: string;
        reference: unknown;
    }>[];
}>;
