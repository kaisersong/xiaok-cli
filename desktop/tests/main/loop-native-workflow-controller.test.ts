// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const leaf = vi.hoisted(() => ({ factory: undefined as any, profile: undefined as any }));
vi.mock('../../../src/runtime/verification/controller-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/runtime/verification/controller-client.js')>(),
  createInstalledVerificationClient: () => leaf.factory(),
}));
vi.mock('../../../src/runtime/verification/migration-markers.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/runtime/verification/migration-markers.js')>(),
  readInstalledCurrentProfile: () => leaf.profile(),
  readInstalledMigrationOwner: () => ({ kind: 'ordinary' }),
}));
import { createAuthenticatedControllerClient } from '../../../src/runtime/verification/controller-client.js';
import { createVerificationCompletionComposition } from '../../../src/runtime/verification/completion-composition.js';
import { openPrivateVerificationDatabase } from '../../../src/runtime/verification/private-database.js';
import { createProfileIndexPublisher, parsePublicProfileIndex } from '../../../src/runtime/verification/profile-index-publication.js';
import { createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';
import { createApplicationBindingAuthority } from '../../../src/runtime/verification/application-binding-authority.js';
import { applicationBindingReviewBytes } from '../../../src/runtime/verification/application-binding-review.js';
import { startPublicController } from '../../../src/runtime/verification/controller-public-daemon.js';
import { createControllerApplicationRouting } from '../../../src/runtime/verification/controller-application-routing.js';
import { callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import type { CompletionMethod } from '../../../src/runtime/verification/completion-transport.js';
import { loopHostSubjectOwner } from '../../../src/runtime/verification/loop-host-subject.js';
import { LoopStore } from '../../electron/loop-store.js';
import { ArtifactEvidenceRegressionScanner } from '../../electron/artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { createLoopNativeWorkflow } from '../../electron/loop-native-workflow.js';
import { createLoopVerificationSessionHost } from '../../electron/loop-verification-session-host.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const H = 'a'.repeat(64), peer = { uid: 501, gid: 20, auditSessionId: 7 };
const definition = (id: string) => ({ version: 1, obligations: [{ obligationId: id, predicateId: 'content', predicateVersion: '1', semantics: 'current-subject', recipe: { kind: 'artifact-content', checks: [{ id: 'check', path: 'report', sha256: H, structure: 'bytes' }] } }] });

// Actual private SQLite authorities, profile filesystem publication, signed
// controller sockets and fixed product clients. OS peer/native UI are explicit
// fixture leaves; this is not an installed OS or actual verification run claim.
it.each(['run', 'scan', 'lost-owner', 'lost-application', 'cancel-owner', 'cancel-application'] as const)(
  'binds an actual Loop candidate through signed controller and original durable requests: %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'loop-native-controller-'));
    const database = openPrivateVerificationDatabase(join(root, 'private'));
    const keys = generateKeyPairSync('ed25519'), markers = join(root, 'markers');
    mkdirSync(markers, { mode: 0o755 });
    const clock = () => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: 1000, upperBound: 1001, evidenceHash: H });
    const resolvePrincipal = (p: typeof peer) => ({ ...p, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555', source: 'macos-local-generateduid' as const });
    let ownerApprovals = 0, applicationApprovals = 0, lost = false;
    const recipeUse = vi.fn((): never => { throw Error('no verification execution in native preparation'); });
    const composition = createVerificationCompletionComposition({ root: join(root, 'private'), database, authorityId: 'authority',
      authority: { receiverVerifier: createReceiverReplyVerifier({ keyId: 'receiver', receiverId: 'receiver', receiverInstanceEpoch: 1, publicKey: keys.publicKey }), issuerId: 'authority', verifierHash: H, keyId: 'key', serviceEpoch: 'boot', privateKey: keys.privateKey, clock, assertQualified() {}, quiescence: { assertQuiescent: recipeUse } },
      enrollment: { resolvePrincipal, profilePublication: createProfileIndexPublisher({ root: markers, database, authorityId: 'authority', assertCurrent() {} }),
        async approve(review) {
          ownerApprovals++;
          if (mode === 'cancel-owner') throw Error('native cancelled');
          return { uid: peer.uid, auditSessionId: peer.auditSessionId, reviewHash: hash(json(review).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))) };
        } },
      recipePorts: { assertCurrent: recipeUse, readArtifact: recipeUse, runBlackbox: recipeUse, readFailedRun: recipeUse, assertFailedRunComplete: recipeUse },
    });
    const application = createApplicationBindingAuthority({ database, authorityId: 'authority', completion: composition, clock, assertCurrent() {}, resolvePrincipal,
      async approve(review) {
        applicationApprovals++;
        if (mode === 'cancel-application') throw Error('native cancelled');
        return { uid: peer.uid, auditSessionId: peer.auditSessionId, reviewHash: hash(applicationBindingReviewBytes(review)) };
      } });
    const routing = createControllerApplicationRouting({ application, assertCurrent() {}, async renew() {} });
    const socketPath = join(root, 'controller.sock');
    const controller = await startPublicController({ socketPath, authorityId: 'authority', serviceEpoch: 'boot', privateKey: keys.privateKey, allowedUserIds: [peer.uid], acceptPeer: () => peer,
      async invoke(method, payload, principal, signal) {
        const result = method.startsWith('application.')
          ? await routing.invoke(method, payload, principal, signal)
          : await composition.public.invoke(method as CompletionMethod, payload, principal, signal);
        if (!lost && (mode === 'lost-owner' && method === 'completion.authorize-owner' || mode === 'lost-application' && method === 'application.authorize')) {
          lost = true; throw Error('reply lost after actual authority commit');
        }
        return result;
      } });
    leaf.factory = () => createAuthenticatedControllerClient({ authorityId: 'authority', publicKey: keys.publicKey, roundTrip: (bytes, signal) => callControllerIpc(socketPath, bytes, { signal }), roundTripSync() { throw Error('unused'); } });
    const profilePath = join(markers, 'principals', String(peer.uid) + '.json');
    leaf.profile = () => existsSync(profilePath) ? { kind: 'protected', index: parsePublicProfileIndex(JSON.parse(readFileSync(profilePath, 'utf8'))) } : { kind: 'ordinary' };
    const storePath = join(root, 'loop.sqlite');
    let store = new LoopStore(storePath);
    let workflow = createLoopNativeWorkflow({ store, assertAdmission() {}, now: () => 20 });
    try {
      expect(leaf.profile()).toEqual({ kind: 'ordinary' });
      const loopId = 'artifact-evidence-regression';
      store.ensureBuiltInLoops(1);
      store.saveLoopPublicationConfiguration({ loopId, expectedRevision: null, requestSource: 'user', now: 2, configuration: { version: 1, contract: { kind: 'builtin-diagnostic', scanner: loopId, objective: 'Original', completionCriterion: 'Original criterion' }, verificationDefinitions: { run: definition('run-original'), stages: { scan: definition('scan-original') } } } });
      const began = store.beginLoopRun(loopId, { kind: 'manual' }, 3, 1000, { requestSource: 'user' });
      if (began.status !== 'started') throw Error('begin');
      const stage = store.startLoopStage(began.run.id, loopId, 'scan', 4), producer = store.openLoopPublicationProducer(began.run);
      const evidencePath = join(root, 'evidence.sqlite'), evidence = new CompletionEvidenceStore(evidencePath), scanner = new ArtifactEvidenceRegressionScanner(evidencePath);
      try { producer.recordScan(stage.id, scanner.scan({ loopRunId: began.run.id, now: 10 }), 10); } finally { scanner.close(); evidence.close(); }
      const candidate = store.recoverLoopPublicationCandidates({ runId: began.run.id, requestSource: 'user' }).find(c => mode === 'scan' ? c.stageId === stage.id : c.stageId === null)!;
      const row = workflow.reserve({ candidateId: candidate.candidateId, expectedLatestAttemptId: null, requestSource: 'user' });
      const input = { attemptId: row.attemptId, requestSource: 'user' as const };
      if (mode.startsWith('lost-') || mode.startsWith('cancel-')) {
        await expect(workflow.advance(input)).rejects.toThrow();
        await workflow.close(); store.close(); store = new LoopStore(storePath);
        workflow = createLoopNativeWorkflow({ store, assertAdmission() {}, now: () => 21 });
        const recovered = await workflow.recover({ ...input, requestSource: 'scheduler' });
        expect(recovered.phase).toBe(mode.startsWith('cancel-') ? 'retired' : mode === 'lost-owner' ? 'enrolled' : 'ready');
        expect(recovered.enrollmentRequestId).toBe(row.enrollmentRequestId);
        expect(recovered.applicationRequestId).toBe(row.applicationRequestId);
        expect(ownerApprovals).toBe(1);
        expect(applicationApprovals).toBe(mode.endsWith('owner') ? 0 : 1);
        if (mode === 'lost-owner') expect((await workflow.advance(input)).phase).toBe('ready');
      } else expect((await workflow.advance(input)).phase).toBe('ready');
      const requested = loopHostSubjectOwner(candidate.binding.subject);
      if (!mode.startsWith('cancel-')) {
        if (requested.ownerKind !== 'loop') throw Error('loop owner required');
        const observation = application.inspect({ ownerKind: requested.ownerKind, ownerId: requested.ownerId }, peer);
        expect(observation.current?.binding).toEqual(candidate.binding);
        const index = leaf.profile().index;
        expect(composition.privateHost.authorityService.inspectOwner({ ...requested, profileId: index.profileId })?.currentVerification).toBe('needs_revalidation');
        expect(composition.privateHost.enrollment.readApprovedRecipe({ ...requested, profileId: index.profileId }, mode === 'scan' ? 'scan-original' : 'run-original')).toEqual(definition('unused').obligations[0]!.recipe);
        expect(applicationApprovals).toBe(1);
      }
      expect(store.getLoopRunLifecycle(began.run.id)?.businessState).toBe('publication_pending');
      expect(database.prepare('SELECT COUNT(*) n FROM verification_registered_invocations').get()).toEqual({ n: 0 });
      expect(recipeUse).not.toHaveBeenCalled();
      if (!mode.startsWith('cancel-')) {
        const host = createLoopVerificationSessionHost({ store, sessionRoot: join(root, 'verification-sessions'), workspaceRoot: root, assertAdmission() {}, now: () => 40 });
        try {
          const session = await host.prepare({ nativeAttemptId: row.attemptId, obligationId: mode === 'scan' ? 'scan-original' : 'run-original', requestSource: 'user' });
          expect((await host.enroll({ id: session.id, requestSource: 'user' })).phase).toBe('enrolled');
          const invocation = { sessionIdentity: session.sessionId, compoundOperationId: session.operationId, validationInvocationId: session.validationInvocationId };
          const owner = { ...requested, profileId: leaf.profile().index.profileId };
          expect(composition.privateHost.enrollment.resolveOwnerKey(peer, invocation)).toBe(json(owner));
          expect(() => composition.privateHost.enrollment.resolveOwnerKey(peer, { ...invocation, validationInvocationId: 'foreign' })).toThrow();
          expect(() => composition.privateHost.enrollment.resolveOwnerKey({ ...peer, uid: 502 }, invocation)).toThrow();
          expect(database.prepare('SELECT COUNT(*) n FROM verification_registered_invocations').get()).toEqual({ n: 1 });
          expect(composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
          expect(ownerApprovals).toBe(2); expect(recipeUse).not.toHaveBeenCalled();
          expect(store.getLoopRunLifecycle(began.run.id)?.businessState).toBe('publication_pending');
        } finally { await host.close(); }
      }
    } finally {
      await workflow.close(); store.close(); await controller.close(); application.close(); composition.close(); database.close(); rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
