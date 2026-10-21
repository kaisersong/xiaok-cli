/** Internal synchronous observation only; owns no deletion or SDK state. */
export function reportDiagnosticSafely<Fact>(
  state: { active: boolean },
  readObserver: () => ((fact: Fact) => void) | undefined,
  buildFact: () => Fact,
): void {
  // Caller owns this plain local state; nested reporting must not re-read getters.
  if (state.active) return;
  state.active = true;
  try {
    const observe = readObserver();
    if (!observe) return;
    const fact = buildFact();
    observe(fact);
  } catch {
    // Getter, fact construction and synchronous callback failures are diagnostic only.
  } finally {
    state.active = false;
  }
}
