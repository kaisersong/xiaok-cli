import { types as utilTypes } from 'node:util';
import { persistMountedQualificationExpected } from '../verification/installed-engine-qualification.js';
import { consumeExecutionCommandContext, assertDockerRunnerDatabase, assertDockerRunnerDeleted } from './docker-runner.js';
import { createHash, randomUUID } from 'node:crypto';
import { createDockerRunner } from './docker-runner.js';
import { extractSingleArtifact } from './artifact-export.js';
import { MOUNTED_POLICY_SHA256 } from './docker-volume-request.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
const mountedInstances = new WeakMap();
export function assertMountedProbeDeleted(probe, database, proof, proposal) { const known = mountedInstances.get(probe); if (!known || known.database !== database)
    throw Error('mounted_probe_database'); assertDockerRunnerDeleted(known.runner, database, proof, proposal); }
const mountedCommands = new WeakMap();
export function inspectMountedProbeCommand(command, raw, database) { const fact = mountedCommands.get(command); if (!fact)
    return false; if (fact.raw !== raw || fact.database !== database)
    throw Error('execution_command_owner'); assertDockerRunnerDatabase(fact.raw, database); return true; }
export function executeMountedProbeCommand(command, context) { const fact = mountedCommands.get(command); if (!fact)
    return false; const transaction = consumeExecutionCommandContext(context, fact.raw, fact.database, command), reserved = fact.raw.reserveExecution(fact.input, transaction); if (fact.qualification)
    persistMountedQualificationExpected(fact.qualification, fact.database, reserved.expected); fact.expected = reserved.expected; return true; }
const capacityPlans = new WeakMap();
export function readMountedProbeCapacityPlan(plan, database) { const known = capacityPlans.get(plan); if (!known)
    return undefined; if (known.database !== database)
    throw Error('mounted_probe_capacity_database'); known.current(); return known.owner; }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Real fixed probe machinery, never a qualification issuer. The installed owner
 * separately verifies service/VM/engine/clock and consumes these actual facts. */
export function createMountedEngineProbe(options) {
    const { database: db, assertCurrent } = options, plans = new WeakMap();
    let closed = false, busy = false;
    const current = () => { if (closed)
        throw Error('mounted_probe_closed'); const value = assertCurrent(); if (value !== undefined) {
        void Promise.resolve(value).catch(() => { });
        throw Error('mounted_probe_authority_sync');
    } };
    const runner = createDockerRunner({ ...options, outputBytes: 65536, assertCurrent: current, stager: { getManifest(plan) { current(); const fact = plans.get(plan); if (!fact)
                throw Error('mounted_probe_plan'); return fact.manifest; }, readFile(plan, path) { current(); const fact = plans.get(plan); if (!fact || path !== 'source')
                throw Error('mounted_probe_plan'); return Buffer.from(fact.bytes); }, readStdin(plan) { current(); const fact = plans.get(plan); if (!fact)
                throw Error('mounted_probe_plan'); return Buffer.from(fact.bytes); } } });
    const api = Object.freeze({ deletionAuthority: runner.deletionAuthority,
        async run(input = {}) {
            if (!input || utilTypes.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !['qualification', 'signal'].includes(key) || !('value' in Object.getOwnPropertyDescriptor(input, key))))
                throw Error('mounted_probe_input');
            current();
            if (busy)
                throw Error('mounted_probe_busy');
            busy = true;
            let expected;
            try {
                options.budget.assertExternalOperationBoundary();
                const nonce = randomUUID(), bytes = Buffer.from(nonce), operation = randomUUID(), command = { argv: ['/bin/sh', '-c', `set -eu
[ "$(cat)" = '${nonce}' ]
[ "$(cat /inputs/source)" = '${nonce}' ]
if printf changed 2>/tmp/input-error > /inputs/source; then exit 91; fi
[ "$(cat /inputs/source)" = '${nonce}' ]
if dd if=/dev/zero of=/artifacts/full bs=4096 count=64 2>/tmp/capacity-error; then exit 92; fi
grep -q 'No space left on device' /tmp/capacity-error
rm /artifacts/full
printf '%s' '${nonce}' > /artifacts/result
ln -s /inputs/source /artifacts/leak
ln -s /inputs /artifacts/ancestor
printf '%s' '${nonce}'
`], cwdRelative: '.' }, invocation = { sessionIdentity: 'private-mounted-probe', compoundOperationId: operation, validationInvocationId: operation }, files = [{ path: 'source', contentHash: hash(bytes), size: bytes.length, executable: false }], scopeDigest = hash(json({ invocation, files, command, policy: MOUNTED_POLICY_SHA256 })), plan = Object.freeze({});
                plans.set(plan, { manifest: Object.freeze({ invocation, command, files, scopeDigest, stdin: { sha256: hash(bytes), bytes: bytes.length } }), bytes });
                if (options.capacityOwner)
                    capacityPlans.set(plan, { database: db, owner: options.capacityOwner, current });
                const prepared = Object.freeze({}), preparedFacts = { database: db, raw: runner, qualification: input.qualification, input: { ...invocation, ownerKey: 'private-engine-qualification', scopeDigest, command, materializedInput: plan }, expected: undefined };
                mountedCommands.set(prepared, preparedFacts);
                try {
                    runner.reserveCommand(prepared);
                    if (!preparedFacts.expected)
                        throw Error('mounted_probe_reservation');
                    expected = preparedFacts.expected;
                }
                finally {
                    mountedCommands.delete(prepared);
                }
                const result = await runner.dispatchExecution(expected, { signal: input.signal }), captured = runner.readCapturedOutput(result.output, { expected }), facts = await runner.inspectExecutionFacts(expected);
                if (result.exitCode !== 0 || !captured.complete || captured.truncated || !captured.stdout.equals(bytes) || captured.stderr.length)
                    throw Error('mounted_probe_execution_failed');
                const artifact = extractSingleArtifact(await runner.readArchive(result.output, 'result', { expected, signal: input.signal }), 'result');
                if (!artifact.equals(bytes))
                    throw Error('mounted_probe_export_hash');
                for (const path of ['leak', 'ancestor/source']) {
                    let refused = false;
                    try {
                        await runner.readArchive(result.output, path, { expected, signal: input.signal });
                    }
                    catch (error) {
                        if (error instanceof Error && ['docker_artifact_type', 'docker_artifact_stat_unknown'].includes(error.message))
                            refused = true;
                        else
                            throw error;
                    }
                    if (!refused)
                        throw Error('mounted_probe_symlink_escape');
                }
                const evidenceHash = hash(json({ expected, facts, policy: MOUNTED_POLICY_SHA256, inputHash: hash(bytes), outputHash: hash(artifact), streamHash: hash(captured.stdout) }));
                await runner.cleanupExecution(expected);
                return Object.freeze({ qualified: false, expected, evidenceHash });
            }
            catch (error) {
                if (expected) {
                    try {
                        await runner.inspectExecutionFacts(expected);
                    }
                    catch { /* No invented terminal fact. */ }
                    try {
                        await runner.cleanupExecution(expected);
                    }
                    catch { /* Exact unknown resources keep the original durable reservation. */ }
                }
                throw error;
            }
            finally {
                busy = false;
            }
        },
        async reconcile(expected) { current(); try {
            await runner.inspectExecutionFacts(expected);
        }
        catch { /* cleanup itself accepts only terminal or never-started cancellation. */ } await runner.cleanupExecution(expected); },
        close() { if (!closed) {
            closed = true;
            runner.close();
        } }, });
    mountedInstances.set(api, { database: db, runner });
    return api;
}
