import { isDeepStrictEqual } from 'node:util';
import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { parseIntentBusinessContract } from '../verification/intent-business-contract.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { readCurrentIntentPublicationDependencies } from './published-dependencies.js';
import { parseIntentNativeContracts } from './native-contract-journal.js';
import { captureIntentData, hasProtectedIntentProducerHistory } from './intent-commit-boundary.js';
import { assertSessionWriteOwnership } from './ownership.js';
/** Fixed issuer helper. The returned closure can only reject changed local
 * facts; it never issues a provider/native/business capability. */
export async function prepareIntentProviderCurrent(input) {
    const { store, sessionId, instanceId, signal } = input, read = store.getIntentNativeLedgerSync?.bind(store);
    if (!read)
        throw Error('intent_provider_canonical_reader_required');
    signal.throwIfAborted();
    const original = read(sessionId), before = original === undefined ? undefined : captureIntentData(original);
    const ids = new Set((before?.intents ?? []).map(row => row.intentId));
    if (before?.activeIntentId)
        ids.add(before.activeIntentId);
    const owners = [...ids].sort().map(ownerId => ({ ownerKind: 'intent', ownerId })), routes = owners.map(owner => readInstalledCurrentOwner(owner));
    const protectedIntent = hasProtectedIntentProducerHistory(before) || routes.some(route => route.kind !== 'ordinary');
    const current = () => { signal.throwIfAborted(); if (!isDeepStrictEqual(read(sessionId), before) || owners.some((owner, index) => !isDeepStrictEqual(readInstalledCurrentOwner(owner), routes[index])))
        throw Error('intent_provider_basis_changed'); signal.throwIfAborted(); };
    current();
    if (!protectedIntent)
        return current;
    if (!before || !instanceId)
        throw Error('intent_provider_fixed_instance_required');
    assertSessionWriteOwnership(before, instanceId, 'send intent provider request');
    const record = before.intents.find(row => row.intentId === before.activeIntentId), native = parseIntentNativeContracts(before.nativeContracts, sessionId).find(row => row.intentId === before.activeIntentId);
    if (!record || !native || before.latestPlan?.intentId !== record.intentId || !isDeepStrictEqual(before.latestPlan, record) || native.subjects.some(subject => subject.attempts.at(-1)?.phase !== 'enrolled'))
        throw Error('intent_provider_native_contract_required');
    const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
    const contract = native.contract, body = pick(record, Object.keys(contract).filter(key => !['version', 'verification', 'stages'].includes(key)));
    const stages = record.stages.map(stage => { const expected = contract.stages.find(value => value.stageId === stage.stageId); if (!expected)
        throw Error('intent_provider_contract_changed'); return { ...pick(stage, Object.keys(expected).filter(key => !['verification', 'steps'].includes(key))), verification: expected.verification, steps: stage.steps.map(step => pick(step, ['stepId', 'key', 'order', 'role', 'skillName', 'dependsOn', 'riskTier'])) }; });
    const actual = parseIntentBusinessContract({ ...body, version: 1, verification: contract.verification, stages });
    if (!isDeepStrictEqual(actual, contract))
        throw Error('intent_provider_contract_changed');
    const stage = record.stages.find(value => value.stageId === record.activeStageId);
    if (!stage || !stage.steps.some(step => step.stepId === record.activeStepId) || !isDeepStrictEqual(record.steps, stage.steps) || record.activeStepId !== stage.activeStepId)
        throw Error('intent_provider_stage_changed');
    if (record.executionTerminals?.some(terminal => terminal.kind === 'step' && terminal.identity === record.activeStepId))
        throw Error('intent_provider_execution_pending');
    if (['completed', 'publication_pending', 'waiting_user'].includes(record.overallStatus) || ['completed', 'publication_pending', 'failed'].includes(stage.status))
        throw Error('intent_provider_execution_pending');
    const subject = { version: 1, sessionId, intentId: record.intentId, stageId: stage.stageId }, owner = intentHostSubjectOwner(subject), route = readInstalledCurrentOwner(owner);
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered')
        throw Error('intent_provider_owner_unavailable');
    const observed = await readCurrentIntentPublicationDependencies(subject, signal);
    current();
    if (!isDeepStrictEqual(observed.registration.contract, contract) || !isDeepStrictEqual(observed.subject, subject) || !isDeepStrictEqual(observed.registration.owner, route.owner))
        throw Error('intent_provider_contract_changed');
    return () => { current(); assertSessionWriteOwnership(read(sessionId), instanceId, 'send intent provider request'); if (!isDeepStrictEqual(readInstalledCurrentOwner(owner), route))
        throw Error('intent_provider_route_changed'); signal.throwIfAborted(); };
}
