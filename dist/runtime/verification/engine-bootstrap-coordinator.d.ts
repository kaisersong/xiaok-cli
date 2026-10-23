import type { createEngineBootstrapJournal, EngineBootstrapProposal, EngineBootstrapObservation } from './engine-bootstrap-journal.js';
/** Service-private order coordinator. These ports are NOT a qualification issuer;
 * installed composition supplies fixed executables and real kernel/guest census. */
export declare function bootstrapPrivateEngine(input: {
    journal: ReturnType<typeof createEngineBootstrapJournal>;
    proposal: EngineBootstrapProposal;
    ports: {
        assertCurrent(): void;
        create(signal?: AbortSignal): Promise<void>;
        initialize(signal?: AbortSignal): Promise<void>;
        observe(signal?: AbortSignal): Promise<EngineBootstrapObservation>;
    };
    signal?: AbortSignal;
}): Promise<Readonly<EngineBootstrapObservation>>;
/** Explicit service-private repair of exact fixed phases. apply must be an
 * idempotent, conflict-refusing installed operation, never an arbitrary script.
 * No VM create/start port is present, and no observation mints qualification. */
export declare function recoverPrivateEngine(input: {
    journal: ReturnType<typeof createEngineBootstrapJournal>;
    proposal: EngineBootstrapProposal;
    ports: {
        assertCurrent(): void;
        observeVm(signal?: AbortSignal): Promise<import('./engine-bootstrap-journal.js').EngineVmObservation>;
        phases: readonly {
            name: import('./engine-bootstrap-journal.js').EngineBootstrapPhase;
            digest: string;
            apply(signal?: AbortSignal): Promise<void>;
            isComplete(signal?: AbortSignal): Promise<boolean>;
        }[];
        observe(signal?: AbortSignal): Promise<EngineBootstrapObservation>;
    };
    signal?: AbortSignal;
}): Promise<Readonly<EngineBootstrapObservation>>;
