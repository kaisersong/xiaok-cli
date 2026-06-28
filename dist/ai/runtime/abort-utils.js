export function isAbortError(error) {
    if (error instanceof DOMException && error.name === 'AbortError')
        return true;
    if (error instanceof Error && error.name === 'AbortError')
        return true;
    if (error instanceof Error) {
        const ctorName = error.constructor?.name ?? '';
        if (ctorName === 'APIUserAbortError')
            return true;
        if (/^Request was aborted\.?$/i.test(error.message))
            return true;
    }
    return false;
}
