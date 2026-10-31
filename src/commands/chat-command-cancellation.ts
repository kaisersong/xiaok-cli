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
export function observeCommandCancellationReason(
  signal: AbortSignal,
  facts: CommandCancellationFacts,
): () => void {
  const token = facts.currentToken();
  const record = () => {
    if (token && facts.liveCommands.has(token)) facts.commandCancellations.get(token)?.add(signal.reason);
  };
  signal.addEventListener('abort', record, { once: true });
  if (signal.aborted) record();
  return () => signal.removeEventListener('abort', record);
}

export function matchesCurrentCommandCancellation(
  error: unknown,
  facts: CommandCancellationFacts,
): boolean {
  if (facts.isIngressClosed() && error === facts.finalizationReason) return true;
  const token = facts.currentToken();
  return !!(token && facts.liveCommands.has(token) && facts.commandCancellations.get(token)?.has(error));
}
