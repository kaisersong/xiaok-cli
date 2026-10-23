import { type CapturedProfileRelation, type CapturedProfileGap } from './captured-profile-relations.js';
type Family = 'file' | 'session' | 'goal' | 'codex' | 'loop' | 'groups' | 'artifact' | 'kswarm' | 'writer-lock';
type Summary = Readonly<{
    sourceId: string;
    snapshotHash: string;
    family: Family;
}>;
export type CapturedProfileEvent = Readonly<{
    kind: 'capture-start';
    sources: readonly Summary[];
}> | Readonly<{
    kind: 'family-fact';
    family: Family;
    fact: unknown;
}> | CapturedProfileRelation | CapturedProfileGap | Readonly<{
    kind: 'complete';
    enumerationComplete: true;
    sources: readonly Summary[];
    digest: string;
    relationCount: number;
    gapCount: number;
    occurrenceCount: number;
    verifiedInputSlots: number;
}>;
/** Complete statements of the supplied capture only; never a native owner/cap. */
export declare function iterateCapturedProfileDeclarations(owner: object, token: object): AsyncGenerator<CapturedProfileEvent, void, unknown>;
export {};
