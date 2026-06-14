export function isAbortError(error) {
    if (error instanceof DOMException && error.name === 'AbortError')
        return true;
    if (error instanceof Error && error.name === 'AbortError')
        return true;
    return false;
}
