/** Same kernel continuous clock only. Authentication belongs to the fixed socket
 * transport; this parser never turns an untrusted response into authority. */
export function validateReceiverClockRoundTrip(value, expected) {
    const v = value, s = v?.sample;
    if (!v || Object.keys(v).sort().join(',') !== 'nonce,sample,version' || v.version !== 1 || v.nonce !== expected.nonce || !s || Object.keys(s).sort().join(',') !== 'domainId,evidenceHash,lowerBound,qualificationEpoch,upperBound' || typeof s.domainId !== 'string' || !/^continuous-[a-zA-Z0-9-]+$/.test(s.domainId) || s.domainId.length > 128 || s.qualificationEpoch !== 1 || typeof s.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.evidenceHash) || !Number.isSafeInteger(s.lowerBound) || !Number.isSafeInteger(s.upperBound) || s.lowerBound < 0 || s.upperBound < s.lowerBound)
        throw Error('receiver_clock_response');
    const { before, after } = expected;
    if (before < 0n || after < before || after - before > 5000000000n)
        throw Error('receiver_clock_rtt');
    // Outward rounding: floor(start), ceil(end), never floating point division.
    const low = before / 1000000n, high = (after + 999999n) / 1000000n;
    if (high > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(s.lowerBound) < low || BigInt(s.upperBound) > high)
        throw Error('receiver_clock_interval');
    return Object.freeze({ ...s, upperBound: Number(high) });
}
