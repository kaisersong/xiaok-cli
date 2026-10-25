/** Archiving cannot alter, replay, or misreport the native operation. The owner
 * must fail closed on unpublished references, independently of tool success. */
export function beginToolObservation(port, input) {
    let capture;
    let unavailable = false;
    let finalized = false;
    try {
        capture = port?.begin(input);
    }
    catch {
        unavailable = true;
    }
    return {
        append(text) {
            if (!capture || unavailable || finalized || !text)
                return;
            try {
                capture.append(text);
            }
            catch {
                unavailable = true;
            }
        },
        finalize(facts) {
            if (!capture || finalized)
                return;
            finalized = true;
            try {
                capture.finalize(unavailable ? { ...facts, incompleteReason: 'collector_unavailable' } : facts);
            }
            catch { /* Missing durable reference stays unavailable; do not fabricate success. */ }
        },
    };
}
