/** Local call bookkeeping only. This helper issues no native custody, approval,
 * owner or capacity capability; actual stores keep their lifetimes private. */
export function createLocalSourceWriterLifetime(errorPrefix) {
    const pending = new Set();
    let sealed = false;
    let closing;
    function admit() {
        if (sealed)
            throw Error(errorPrefix + '_closed');
        let resolve;
        const completion = new Promise(done => { resolve = done; });
        pending.add(completion);
        return (outcome) => { pending.delete(completion); resolve(outcome); };
    }
    return Object.freeze({
        runAsync(work) {
            const done = admit();
            let result;
            try {
                result = work();
            }
            catch (error) {
                done({ failed: true, error });
                return Promise.reject(error);
            }
            // Both handlers resolve normally; no ignored rejected finally-Promise.
            void result.then(() => done({ failed: false }), error => done({ failed: true, error }));
            return result;
        },
        runSync(work) {
            const done = admit();
            try {
                const result = work();
                done({ failed: false });
                return result;
            }
            catch (error) {
                done({ failed: true, error });
                throw error;
            }
        },
        close() {
            if (closing)
                return closing;
            sealed = true;
            closing = Promise.all([...pending]).then(outcomes => {
                const errors = outcomes.flatMap(outcome => outcome.failed ? [outcome.error] : []);
                if (errors.length)
                    throw new AggregateError(errors, errorPrefix + '_close_unconfirmed');
            });
            return closing;
        },
    });
}
