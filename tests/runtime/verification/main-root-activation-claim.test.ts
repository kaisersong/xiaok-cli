import { afterEach, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigrationMarkerJournal } from '../../../src/runtime/verification/migration-marker-journal.js';
import { createProfileOwnerRegistry, reservePendingVerificationProfile } from '../../../src/runtime/verification/profile-owner-registry.js';
import { openPrivateVerificationDatabase } from '../../../src/runtime/verification/private-database.js';
import { runVerificationTransaction } from '../../../src/runtime/verification/storage-budget.js';
import { mainRootFamilyTargets, parseMainRootFamilyEnrollmentRecord } from '../../../src/runtime/verification/main-root-family-enrollment-data.js';
import { encodeMainRootAcceptedProjection, mainRootActivationClaimCoreHash } from '../../../src/runtime/verification/main-root-enrollment-codec.js';
import { createVerificationCompletionComposition } from '../../../src/runtime/verification/completion-composition.js';
import { createProfileIndexPublisher } from '../../../src/runtime/verification/profile-index-publication.js';
import { createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';
import { mainRootEnrollmentCodecFixture } from '../../support/main-root-enrollment-codec.fixture.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const principal = { uid: 501, gid: 20, auditSessionId: 7, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555' };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { const errors = []; for (const close of cleanup.splice(0).reverse())
    try {
        await close();
    }
    catch (error) {
        errors.push(error);
    } if (errors.length)
    throw new AggregateError(errors, 'claim fixture cleanup'); });
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'main-root-claim-')), markers = join(root, 'markers');
    mkdirSync(markers, { mode: 0o755 });
    const database = openPrivateVerificationDatabase(join(root, 'db'));
    createProfileOwnerRegistry({ database, authorityId: 'authority', resolvePrincipal: () => ({ uid: 501, accountId: principal.accountGeneration.toLowerCase() }), assertEnrollmentAuthorization() { throw Error('unused business grant'); }, assertEnrollmentCurrent() { }, publishProfile() { throw Error('must not publish profile'); }, assertProfilePublished() { throw Error('unused'); } });
    const journal = createMigrationMarkerJournal({ root: markers, database, authorityId: 'authority', assertCurrent() { }, assertAuthorized() { throw Error('not a business marker grant'); } });
    const profile = runVerificationTransaction(database, () => reservePendingVerificationProfile(database, { uid: 501, accountId: principal.accountGeneration.toLowerCase() }));
    const pending = parseMainRootFamilyEnrollmentRecord({ version: 1, purpose: 'main-root-family-enrollment', state: 'pending', phase: 'prepared', boot: 'fixture', requestId: 'pending-request', review: { version: 1, purpose: 'main-root-family-enrollment', authorizationScope: 'pending-only', authorityId: 'authority', operationId: 'pending-op', challengeId: 'challenge', profileId: profile.profile_id, principal, deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1000, validUntil: 2000 }, targets: mainRootFamilyTargets() } });
    runVerificationTransaction(database, () => journal.prepareMainRootFamilyIntent(pending));
    const keys = generateKeyPairSync('ed25519');
    const composition = createVerificationCompletionComposition({
        root, database, authorityId: 'authority',
        authority: {
            receiverVerifier: createReceiverReplyVerifier({ keyId: 'receiver', receiverId: 'receiver', receiverInstanceEpoch: 1, publicKey: keys.publicKey }),
            issuerId: 'authority', verifierHash: 'a'.repeat(64), keyId: 'key', serviceEpoch: 'boot', privateKey: keys.privateKey,
            clock: () => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: 1000, upperBound: 1001, evidenceHash: 'a'.repeat(64) }),
            assertQualified() {}, quiescence: { assertQuiescent() {} },
        },
        enrollment: {
            resolvePrincipal: () => ({ ...principal, source: 'macos-local-generateduid' as const }),
            approve: async () => { throw Error('unused owner approval'); },
            profilePublication: createProfileIndexPublisher({ root: markers, database, authorityId: 'authority', assertCurrent() {} }),
            mainRootFamily: { publication: journal, assertCurrent() {}, approve: async () => { throw Error('not a final activation approval'); } },
        },
        recipePorts: { assertCurrent() {}, assertFailedRunComplete() { throw Error('unused'); }, async readArtifact() { throw Error('unused'); }, async runBlackbox() { throw Error('unused'); }, async readFailedRun() { throw Error('unused'); } },
    });
    const invoke = (method: string, payload: unknown) => composition.public.invoke(method as never, payload, { uid: 501, gid: 20, auditSessionId: 7 }, new AbortController().signal);
    cleanup.push(async () => { await composition.close(); database.close(); rmSync(root, { recursive: true, force: true }); });
    function record(requestId = 'activation-request', operationId = 'activation-op') {
        const projection = mainRootEnrollmentCodecFixture();
        projection.buildKind = 'production';
        projection.uid = 501;
        for (const fact of projection.sourceFacts)
            fact.uid = 501;
        projection.authorityIdHash = hash('authority');
        projection.profileHash = hash(profile.profile_id);
        projection.operationHash = hash(operationId);
        projection.pendingOperationHash = hash('pending-op');
        projection.committedCommandHash = mainRootActivationClaimCoreHash(encodeMainRootAcceptedProjection(projection));
        return { version: 1, purpose: 'main-root-family-activation', phase: 'claim_committed', authorityId: 'authority', activationRequestId: requestId, operationId, pendingOperationId: 'pending-op', profileId: profile.profile_id, principal, sourceEntryId: 'a'.repeat(64), projectionHex: encodeMainRootAcceptedProjection(projection).toString('hex') };
    }
    const prepare = (raw: unknown) => runVerificationTransaction(database, () => ((journal as any).prepareMainRootActivationClaim(raw)));
    return { root, markers, database, journal, record, prepare, invoke };
}
it('records one real transaction claim in the original journal without minting Source approval or touching the target namespace', () => {
    const f = fixture(), record = f.record();
    expect(f.prepare(record)).toEqual(record);
    const row = f.database.prepare("SELECT state,published FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get();
    expect(row).toEqual({ state: 'activation_claim', published: 0 });
    expect(existsSync(join(f.markers, 'principals'))).toBe(false);
    expect(existsSync(join(f.markers, 'main-root-family.enrollment'))).toBe(false);
});
it('replays the same bytes and blocks a different request for the same original account in the same transaction owner', () => {
    const f = fixture(), record = f.record();
    expect(f.prepare(record)).toEqual(record);
    expect(f.prepare(record)).toEqual(record);
    expect(() => f.prepare(f.record('replacement', 'replacement-op'))).toThrow('main_root_activation_conflict');
    expect(f.database.prepare("SELECT count(*) n FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get()).toEqual({ n: 1 });
});
it('rejects no transaction, a caller selected authority/profile, pending-only variant and altered noncircular command binding', () => {
    const f = fixture(), record = f.record();
    expect(() => ((f.journal as any).prepareMainRootActivationClaim(record))).toThrow('main_root_activation_transaction');
    for (const changed of [{ ...record, authorityId: 'foreign' }, { ...record, profileId: 'foreign' }, { ...record, purpose: 'main-root-family-enrollment' }, { ...record, known: true }])
        expect(() => f.prepare(changed)).toThrow('main_root_activation_claim');
    const plan = mainRootEnrollmentCodecFixture();
    plan.buildKind = 'production';
    plan.uid = 501;
    for (const fact of plan.sourceFacts)
        fact.uid = 501;
    expect(() => f.prepare({ ...record, projectionHex: encodeMainRootAcceptedProjection(plan).toString('hex') })).toThrow('main_root_activation_claim');
    expect(f.database.prepare("SELECT count(*) n FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get()).toEqual({ n: 0 });
});
it('rolls back the original claim with the owner transaction and never replaces a committed namespace plan', () => {
    const f = fixture(), record = f.record(), failure = Error('original caller transaction failed');
    expect(() => runVerificationTransaction(f.database, () => { (f.journal as any).prepareMainRootActivationClaim(record); throw failure; })).toThrow(failure);
    expect(f.database.prepare("SELECT count(*) n FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get()).toEqual({ n: 0 });
    expect(f.prepare(record)).toEqual(record);
    const replaced = f.record();
    const bytes = Buffer.from(replaced.projectionHex, 'hex');
    bytes[264] ^= 1;
    expect(() => f.prepare({ ...replaced, projectionHex: bytes.toString('hex') })).toThrow('main_root_activation_claim');
});

it('the actual public read and recovery routes expose only an incomplete claim, never an accepted grant', async () => {
    const f = fixture(); f.prepare(f.record());
    for (const method of ['completion.read-main-root-family', 'completion.recover-main-root-family']) {
        const body = { operationId: 'pending-op', ...(method.includes('recover') ? { requestSource: 'user' } : {}) };
        const result = await f.invoke(method, body);
        expect(result).toMatchObject({ pendingOnly: true, activation: 'claim-recorded', activationOperationId: 'activation-op', blockers: ['activation_completion_required'], physicalCompletion: 'not-attested' });
        expect(result).not.toHaveProperty('projectionHex'); expect(result).not.toHaveProperty('sourceEntryId');
    }
    expect(existsSync(join(f.markers, 'main-root-family.enrollment'))).toBe(false);
});
it('the actual public cancel cannot erase or replace a frozen activation relation through its old pending sibling', async () => {
    const f = fixture(), record = f.record(); f.prepare(record);
    await expect(f.invoke('completion.cancel-main-root-family', { operationId: 'pending-op', requestSource: 'user' })).rejects.toThrow('main_root_activation_requires_recovery');
    const before = f.database.prepare("SELECT marker_json FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get();
    expect(f.prepare(record)).toEqual(record);
    expect(f.database.prepare("SELECT marker_json FROM migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%'").get()).toEqual(before);
    expect(f.journal.readMainRootFamilyIntents(principal)[0]?.phase).toBe('prepared');
    expect(existsSync(join(f.markers, 'principals'))).toBe(false);
});
