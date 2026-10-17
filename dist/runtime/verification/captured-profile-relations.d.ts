export interface CapturedProfileOrigin {
    readonly sourceId: string;
    readonly path: string;
}
export interface CapturedProfileIdentity extends CapturedProfileOrigin {
    readonly namespace: string;
    readonly id: string;
}
export interface CapturedProfileRelation {
    readonly kind: 'relation';
    readonly namespace: string;
    readonly id: string;
    readonly origin: CapturedProfileOrigin;
    readonly scope?: unknown;
    readonly resolution: 'exact-physical' | 'unique-declaration' | 'ambiguous' | 'missing';
    readonly targets: readonly CapturedProfileIdentity[];
}
export interface CapturedProfileGap {
    readonly kind: 'gap';
    readonly reason: string;
    readonly origin: CapturedProfileOrigin;
    readonly detail?: unknown;
}
type RecordValue = Readonly<Record<string, unknown>>;
export declare function profileRecord(value: unknown): RecordValue;
export declare function profileKeys(value: unknown, keys: readonly string[]): void;
/** Historical indices only. They cannot issue native ownership or read grants. */
export declare class CapturedProfileRelations {
    private occurrences;
    private emittedOccurrences;
    private readonly definitions;
    definitionOccurrences(): Generator<Readonly<{
        identity: CapturedProfileIdentity;
        count: number;
    }>, void, unknown>;
    private readonly identities;
    private readonly pending;
    private readonly immediate;
    private key;
    define(namespace: string, id: unknown, origin: CapturedProfileOrigin, scope?: unknown): void;
    ref(namespace: string, id: unknown, origin: CapturedProfileOrigin, options?: {
        scope?: unknown;
        exactSource?: string;
        exactPhysical?: boolean;
        external?: boolean;
    }): void;
    gap(reason: string, origin: CapturedProfileOrigin, detail?: unknown): void;
    takeGaps(): Generator<CapturedProfileGap, void, unknown>;
    completeOccurrences(): number;
    complex(value: unknown, origin: CapturedProfileOrigin): void;
    session(value: unknown, sourceId: string, path: string): void;
    task(value: unknown, sourceId: string, path: string): void;
    goal(value: unknown, sourceId: string, path: string): void;
    migration(value: unknown, sourceId: string, path: string): void;
    nativeGoal(value: unknown, sourceId: string, path: string): void;
    private registrationSource;
    private obligation;
    finish(): Generator<CapturedProfileRelation | CapturedProfileGap>;
}
export {};
