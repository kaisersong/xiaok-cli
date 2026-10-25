import { canonicalVerificationJson as json } from './protocol.js';
/** Private ordering helper, not an approval issuer or OS qualifier. The installed
 * entry supplies the real broker and qualified owner; the original approval is
 * returned unchanged only while its original clock deadline still holds. */
export async function refreshNativeApprovalQualification(input) {
    const { approval, originalEngineBinding, ensureQualified, currentEngineBinding, clock, assertCurrent } = input, deadline = Object.freeze({ ...input.deadline });
    function check() { const result = assertCurrent(); if (result !== undefined) {
        void Promise.resolve(result).catch(() => { });
        throw Error('native_refresh_sync');
    } const sample = clock(); if (sample.domainId !== deadline.domainId || sample.qualificationEpoch !== deadline.qualificationEpoch || !Number.isSafeInteger(sample.lowerBound) || !Number.isSafeInteger(sample.upperBound) || sample.upperBound < sample.lowerBound || sample.lowerBound < deadline.notBefore || sample.upperBound >= deadline.validUntil)
        throw Error('native_refresh_deadline'); }
    check();
    await ensureQualified();
    check();
    if (currentEngineBinding() !== originalEngineBinding)
        throw Error('native_refresh_engine_changed');
    return approval;
}
/** The initial installed engine identity is captured once, before any requests. */
export function createStableQualificationRefresh(input) {
    const ensure = input.ensureCurrent.bind(input), read = input.readBinding.bind(input), current = input.assertCurrent.bind(input);
    current();
    const original = json(read());
    return async (signal) => { await ensure(signal); current(); signal?.throwIfAborted(); if (json(read()) !== original)
        throw Error('installed_controller_engine_changed'); };
}
