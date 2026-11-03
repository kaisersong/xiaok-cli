/** The actual caller supplies its ONE already-started public producer Promise. */
export function ownPendingClose(settled) {
    let closing;
    return { settled, close() { return closing ??= settled.then(value => value.close()); } };
}
