import { type CapturedProfileOrigin } from './captured-profile-relations.js';
/** Independent input catalogue. It never calls the relation projector. */
export declare class CapturedProfileSlots {
    private readonly targetDefinitions;
    private targetKey;
    checkDefinitions(entries: Iterable<Readonly<{
        identity: Readonly<{
            namespace: string;
            id: string;
            sourceId: string;
            path: string;
        }>;
        count: number;
    }>>): void;
    private readonly expected;
    private readonly observed;
    private key;
    private add;
    private ref;
    private gap;
    start(sources: readonly Readonly<{
        sourceId: string;
    }>[]): void;
    note(event: Readonly<{
        kind: string;
        origin?: CapturedProfileOrigin;
        namespace?: string;
        id?: string;
    }>): void;
    complete(): number;
    private list;
    private each;
    private session;
    private task;
    private goal;
    private migration;
    private obligation;
    private registrationSource;
    private nativeGoal;
    fact(family: string, value: unknown): void;
    private stream;
}
