export interface CommandCancellationFacts {
    readonly isIngressClosed: () => boolean;
    readonly finalizationReason: unknown;
    readonly currentToken: () => object | undefined;
    readonly liveCommands: ReadonlySet<object>;
    readonly commandCancellations: WeakMap<object, Set<unknown>>;
}
/** Observe the actual signal reason only for the original live command token.
 * This records local DATA identity; it never creates an admission or permission.
 */
export declare function observeCommandCancellationReason(signal: AbortSignal, facts: CommandCancellationFacts): () => void;
export declare function matchesCurrentCommandCancellation(error: unknown, facts: CommandCancellationFacts): boolean;
