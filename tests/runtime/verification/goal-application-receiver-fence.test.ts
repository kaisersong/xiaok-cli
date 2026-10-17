import '../../support/installed-controller-fixture.js';
import { it, expect } from 'vitest';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifiedOperationFixture } from '../../support/verified-operation-fixture.js';
import { VerificationReceiverStore } from '../../../src/runtime/verification/receiver-store.js';
import { startReceiverService } from '../../../src/runtime/verification/receiver-service.js';
import { createReceiverTransport } from '../../../src/runtime/verification/receiver-transport.js';
import { createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';
import { createReceiverUploadVerifier } from '../../../src/runtime/verification/receiver-upload-authentication.js';
import { publicationReviewBytes } from '../../../src/runtime/verification/publication-operation-review.js';
import { applicationBindingReviewBytes } from '../../../src/runtime/verification/application-binding-review.js';
import { createApprovedPublicationOperations } from '../../../src/runtime/verification/approved-publication-operation.js';
import { createApplicationBindingAuthority } from '../../../src/runtime/verification/application-binding-authority.js';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
it.each([false, true])('native Goal replacement waits for the original receiver ACK (competing publication: %s)', async competing => {
  const f = await verifiedOperationFixture('goal-application'), identity = f.receiverIdentity, socketPath = join(f.root, 'receiver.sock');
  const store = new VerificationReceiverStore({ root: join(f.root, 'receiver-state'), ...identity, clock: f.clock });
  // Real signed receiver/SQLite pipeline. Peer and native reply are boundary fixtures, not installed OS qualification.
  const server = await startReceiverService({ socketPath, controllerServiceUid: 501, identity, privateKey: f.keys.privateKey, store, assertCurrent() {}, readPeer: () => ({ ...f.peer, pid: 123 }) });
  const transport = createReceiverTransport({ socketPath, receiverServiceUid: 700, identity, verifier: createReceiverReplyVerifier({ ...identity, publicKey: f.keys.publicKey }), uploadVerifier: createReceiverUploadVerifier({ ...identity, publicKey: f.keys.publicKey }), assertCurrent() {}, readPeer: () => ({ uid: 700, gid: 700, auditSessionId: 1, pid: 234 }) });
  const resolvePrincipal = (p: typeof f.peer) => ({ ...p, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555', source: 'macos-local-generateduid' as const });
  let commits = 0, approvals = 0, queryOffline = false;
  const publication = createApprovedPublicationOperations({ database: f.database, authorityId: 'authority', completion: f.composition, verification: f.operations,
    receiverIdentity: identity, receiver: { stagePayload: transport.stagePayload.bind(transport), async call(...args: Parameters<typeof transport.call>) {
      if (args[0] === 'query' && queryOffline) throw Error('receiver offline');
      const reply = await transport.call(...args);
      if (args[0] === 'commit') { commits++; throw Error('lost actual commit ACK'); }
      return reply;
    } }, clock: f.clock, assertCurrent() {}, resolvePrincipal,
    async approve(review) { return { version: 1, purpose: 'completion-publication', authorityId: review.authorityId, challengeId: review.challengeId,
      uid: review.principal.uid, accountGeneration: review.principal.accountGeneration, auditSessionId: review.principal.auditSessionId,
      requestSource: review.requestSource, fullReviewHash: hash(publicationReviewBytes(review)) }; },
  });
  const applicationOptions = { database: f.database, authorityId: 'authority', completion: f.composition, clock: f.clock, assertCurrent() {}, resolvePrincipal,
    async approve(review: Parameters<typeof applicationBindingReviewBytes>[0]) { approvals++; return { uid: f.peer.uid, auditSessionId: f.peer.auditSessionId, reviewHash: hash(applicationBindingReviewBytes(review)) }; } };
  let application = createApplicationBindingAuthority(applicationOptions);
  try {
    const challenge = publication.prepare({ ownerKind: 'goal', ownerId: 'goal', requestSource: 'agent' }, f.peer);
    await expect(publication.approve({ challengeId: challenge.challengeId }, f.peer, new AbortController().signal)).rejects.toThrow('lost actual commit ACK');
    const review = JSON.parse((f.database.prepare('SELECT review_json FROM publication_operations WHERE id=?').get(challenge.challengeId) as { review_json: string }).review_json);
    expect(store.readVisible(review.tuple.operationId)).toBeTruthy(); expect(commits).toBe(1);
    const second = competing ? publication.prepare({ ownerKind: 'goal', ownerId: 'goal', requestSource: 'agent' }, f.peer) : undefined;
    if (second) {
      await expect(publication.approve({ challengeId: second.challengeId }, f.peer, new AbortController().signal)).rejects.toThrow('verification_reservation_fenced');
      const records = f.database.prepare('SELECT state_json FROM publication_journal').all() as Array<{ state_json: string }>;
      expect(records).toHaveLength(1); expect(records.every(r => ['pending','commit_authorized'].includes(JSON.parse(r.state_json).reservation))).toBe(true);
    }
    const original = application.inspect({ ownerKind: 'goal', ownerId: 'goal' }, f.peer).current!;
    if(original.binding.kind!=='goal')throw Error('expected actual Goal application');
    const next = application.prepare({ requestSource: 'user', binding: { ...original.binding, epoch: 2, objective: 'new original Goal objective' } }, f.peer);
    expect(await application.authorize({ requestSource: 'user', challengeId: next.challengeId }, f.peer, new AbortController().signal)).toMatchObject({ state: 'pending', current: { binding: { epoch: 1 } } });
    application.close(); application = createApplicationBindingAuthority(applicationOptions);
    expect(application.reconcile({ requestSource: 'scheduler', challengeId: next.challengeId }, f.peer).state).toBe('pending');
    queryOffline = true; await expect(publication.reconcile({ challengeId: challenge.challengeId }, f.peer, new AbortController().signal)).rejects.toThrow('receiver offline');
    expect(application.reconcile({ requestSource: 'scheduler', challengeId: next.challengeId }, f.peer).state).toBe('pending');
    expect(f.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).not.toBe('valid');
    queryOffline = false;
    expect((await publication.reconcile({ challengeId: challenge.challengeId }, f.peer, new AbortController().signal)).status).toBe('committed');
    expect(application.reconcile({ requestSource: 'scheduler', challengeId: next.challengeId }, f.peer)).toMatchObject({ state: 'active', current: { binding: { epoch: 2 }, revision: 2 } });
    expect(f.composition.privateHost.authorityService.inspectOwner(f.owner)?.currentVerification).toBe('needs_revalidation');
    expect(commits).toBe(1); expect(approvals).toBe(1);
  } finally { application.close(); await publication.close(); await server.close(); store.close(); f.close(); }
});
