function normalizeWarningCode(args) {
    const first = args[0];
    if (typeof first === 'string' && /^DEP\d{4}$/.test(first)) {
        return first;
    }
    const second = args[1];
    if (typeof second === 'string' && /^DEP\d{4}$/.test(second)) {
        return second;
    }
    return undefined;
}
export function shouldSuppressWarning(warning, args = []) {
    const message = warning instanceof Error ? warning.message : String(warning ?? '');
    const code = warning instanceof Error && 'code' in warning && typeof warning.code === 'string'
        ? warning.code
        : normalizeWarningCode(args);
    return code === 'DEP0040' && message.includes('`punycode` module is deprecated');
}
export function installWarningFilter() {
    const originalEmitWarning = process.emitWarning.bind(process);
    process.emitWarning = ((warning, ...args) => {
        if (shouldSuppressWarning(warning, args)) {
            return;
        }
        return originalEmitWarning(warning, ...args);
    });
}
