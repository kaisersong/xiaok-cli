// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
it.each(['missing-enrollment','changed-account','close-enrollment'])('explicit reauthorization retains real request and native boundaries: %s', async (scenario:string) => {
    const mode:string='reauth';let armed=false,decline=false,otherCommitted=false;
    const root = mkdtempSync(join(tmpdir(), 'loop-native-controller-'));
    const database = openPrivateVerificationDatabase(join(root, 'private'));
    const keys = generateKeyPairSync('ed25519'), markers = join(root, 'markers');
    mkdirSync(markers, { mode: 0o755 });
    let actualTime=1000;const clock = () => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: actualTime, upperBound: actualTime+1, evidenceHash: H });
    let accountGeneration='11111111-AAAA-BBBB-CCCC-555555555555';
    const resolvePrincipal = (p: typeof peer) => ({ ...p, accountGeneration, source: 'macos-local-generateduid' as const });
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
        if (decline || mode === 'cancel-application') throw Error('native cancelled');
        return { uid: peer.uid, auditSessionId: peer.auditSessionId, reviewHash: hash(applicationBindingReviewBytes(review)) };
      } });
    let exactBinding:any;
    async function externalCommit(){const p=application.prepareRequest({requestSource:'user',requestId:'other-explicit-user-request',binding:exactBinding},peer);await application.authorize({requestSource:'user',challengeId:p.challenge.challengeId},peer,new AbortController().signal);otherCommitted=true;}
    const routing = createControllerApplicationRouting({ application, assertCurrent() {}, async renew() {} });
    const socketPath = join(root, 'controller.sock');
    const controller = await startPublicController({ socketPath, authorityId: 'authority', serviceEpoch: 'boot', privateKey: keys.privateKey, allowedUserIds: [peer.uid], acceptPeer: () => peer,
      async invoke(method, payload, principal, signal) {
        if(armed&&scenario==='close-enrollment'&&method==='completion.recover-owner-request')void workflow.close();
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
    const abort=new AbortController();
    const admission=()=>{if(armed&&scenario==='abort-tail'&&store.listLoopNativeAttempts(exactCandidateId).length>1)abort.abort(Error('late abort'));};
    let exactCandidateId='';
    let workflow = createLoopNativeWorkflow({ store, assertAdmission:admission, now: () => 20 });
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
      exactBinding=candidate.binding;exactCandidateId=candidate.candidateId;
      const row = workflow.reserve({ candidateId: candidate.candidateId, expectedLatestAttemptId: null, requestSource: 'user' });
      const input = { attemptId: row.attemptId, requestSource: 'user' as const };
      database.exec("CREATE TRIGGER hold_original_transition BEFORE INSERT ON verification_application_history BEGIN SELECT RAISE(ABORT,'held original transition'); END");
      await expect(workflow.advance(input)).rejects.toThrow();
      database.exec('DROP TRIGGER hold_original_transition');
      expect(ownerApprovals).toBe(1);expect(applicationApprovals).toBe(1);
      const originalTransition=database.prepare("SELECT transition_id FROM verification_application_transitions WHERE state='pending'").get() as {transition_id:string};expect(originalTransition.transition_id).toBeTruthy();
      actualTime=400001;
      const expired=await workflow.recover({...input,requestSource:'scheduler'});expect(expired.phase).toBe('needs_reauthorization');
      expect(ownerApprovals).toBe(1);expect(applicationApprovals).toBe(1);
      expect(()=>workflow.reserve({candidateId:candidate.candidateId,expectedLatestAttemptId:expired.attemptId,requestSource:'user'})).toThrow('pending');
      const request={attemptId:expired.attemptId,expectedRevision:expired.revision,requestSource:'user' as const,signal:abort.signal};
      armed=true;
      if(scenario==='missing-enrollment')database.prepare('DELETE FROM owner_enrollment_requests WHERE request_id=?').run(row.enrollmentRequestId);
      if(scenario==='changed-account')accountGeneration='22222222-AAAA-BBBB-CCCC-555555555555';
      if(['missing-enrollment','changed-account','close-enrollment'].includes(scenario)){
        await expect(workflow.reauthorizeApplication(request)).rejects.toThrow();
        expect(store.listLoopNativeAttempts(candidate.candidateId)).toEqual([expired]);
        expect(applicationApprovals).toBe(1);expect(ownerApprovals).toBe(1);return;
      }

    } finally {
      await workflow.close(); store.close(); await controller.close(); application.close(); composition.close(); database.close(); rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
