import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertInstalledReceiverLifetime } from './installed-receiver-lifetime.js';
import { assertRootProtectedExecutable, assertRootProtectedFile } from './installed-identity.js';
import { readKernelContinuousNanoseconds } from './continuous-clock.js';
import { validateReceiverClockRoundTrip } from './receiver-clock-protocol.js';
/** Synchronous samples from the original root broker's continuous clock domain.
 * No alternate endpoint, identity, clock or lifetime can be provided. */
export function createInstalledReceiverClock(lifetime) {
    assertInstalledReceiverLifetime(lifetime);
    if (arguments.length !== 1)
        throw Error('receiver_clock_arguments');
    const node = join(lifetime.release, 'bin/node'), entry = join(lifetime.release, 'app/receiver-clock-transport.cjs'), kernel = join(lifetime.release, 'bin/continuous-clock');
    let closed = false, invalid = false, identity, last = 0n;
    function current() { if (closed || invalid)
        throw Error('receiver_clock_closed'); assertInstalledReceiverLifetime(lifetime); assertRootProtectedExecutable(node); assertRootProtectedExecutable(kernel); assertRootProtectedFile(entry); }
    current();
    return Object.freeze({ sample() {
            try {
                current();
                const nonce = randomBytes(32).toString('hex'), before = readKernelContinuousNanoseconds(kernel);
                if (before < last)
                    throw Error('receiver_clock_backwards');
                const result = spawnSync(node, [entry], { cwd: '/', env: { PATH: '/usr/bin:/bin' }, input: nonce, encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
                current();
                if (result.error || result.status !== 0 || result.signal)
                    throw Error('receiver_clock_transport_unknown');
                // Last synchronous identity/file checks precede the final kernel measurement.
                // Everything after it is bounded in-memory parsing, with no further OS IO.
                const after = readKernelContinuousNanoseconds(kernel);
                const sample = validateReceiverClockRoundTrip(JSON.parse(result.stdout), { nonce, before, after }), id = JSON.stringify([sample.domainId, sample.qualificationEpoch, sample.evidenceHash]);
                if (identity !== undefined && identity !== id)
                    throw Error('receiver_clock_domain_changed');
                identity = id;
                last = after;
                return sample;
            }
            catch (error) {
                invalid = true;
                throw error;
            }
        }, close() { closed = true; } });
}
