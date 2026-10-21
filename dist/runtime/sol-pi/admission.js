const GATES = ['capability', 'efficiency', 'cost', 'experience', 'mechanism'];
export function evaluateSolPiAdmission(input) {
    const result = (status, reasons) => ({ candidate: input.candidate, status, reasons, enableByDefault: false });
    if (input.candidate !== 'P3-R' && input.candidate !== 'P3-C')
        return result('no-go', ['unsupported_candidate']);
    // No qualified isolated adapter/control plane exists in this implementation.
    // Caller supplied claims must never confer trusted receipt capability.
    if (input.candidate === 'P3-R')
        return result('no-go', ['trusted_receipt_unavailable']);
    const failed = GATES.filter(gate => input.gates?.[gate] === 'failed');
    if (failed.length)
        return result('no-go', failed.map(gate => `${gate}_failed`));
    const unknown = GATES.filter(gate => input.gates?.[gate] !== 'passed');
    if (unknown.length)
        return result('inconclusive', unknown.map(gate => `${gate}_inconclusive`));
    return result('eligible-for-experiment', []);
}
