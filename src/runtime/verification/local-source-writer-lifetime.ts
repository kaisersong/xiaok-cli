/** Local call bookkeeping only. This helper issues no native custody, approval,
 * owner or capacity capability; actual stores keep their lifetimes private. */
export function createLocalSourceWriterLifetime(errorPrefix: string) {
  type Outcome = { failed: false } | { failed: true; error: unknown };
  const pending = new Set<Promise<Outcome>>();
  let sealed = false;
  let closing: Promise<void> | undefined;
  function admit() {
    if (sealed) throw Error(errorPrefix + '_closed');
    let resolve!: (outcome: Outcome) => void;
    const completion = new Promise<Outcome>(done => { resolve = done; });
    pending.add(completion);
    return (outcome: Outcome) => { pending.delete(completion); resolve(outcome); };
  }
  return Object.freeze({
    runAsync<T>(work: () => Promise<T>): Promise<T> {
      const done = admit();
      let result: Promise<T>;
      try { result = work(); } catch (error) { done({ failed: true, error }); return Promise.reject(error); }
      // Both handlers resolve normally; no ignored rejected finally-Promise.
      void result.then(() => done({ failed: false }), error => done({ failed: true, error }));
      return result;
    },
    runSync<T>(work: () => T): T {
      const done = admit();
      try { const result = work(); done({ failed: false }); return result; }
      catch (error) { done({ failed: true, error }); throw error; }
    },
    close(): Promise<void> {
      if (closing) return closing;
      sealed = true;
      closing = Promise.all([...pending]).then(outcomes => {
        const errors = outcomes.flatMap(outcome => outcome.failed ? [outcome.error] : []);
        if (errors.length) throw new AggregateError(errors, errorPrefix + '_close_unconfirmed');
      });
      return closing;
    },
  });
}
