import '../../support/installed-controller-fixture.js';
import { it, expect } from 'vitest';
import { verifiedOperationFixture } from '../../support/verified-operation-fixture.js';
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import { join } from 'node:path';
import { startPublicController } from '../../../src/runtime/verification/controller-public-daemon.js';
import { createControllerOperationRouting } from '../../../src/runtime/verification/controller-operation-routing.js';
import { createAuthenticatedControllerClient } from '../../../src/runtime/verification/controller-client.js';
import { callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
const invocation = { sessionIdentity: 's', compoundOperationId: 'o', validationInvocationId: 'v' };

it('reads the actual registered obligation epoch and Loop application without issuing any new execution', async () => {
  const f = await verifiedOperationFixture('loop-application');
  try {
    // Existing permission checks checkpoint the monotonic clock. Compare
    // durable contents, rather than assuming a read makes no SQL UPDATE call.
    const state = () => (f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
      .map(({ name }) => { if (!/^[a-zA-Z0-9_]+$/.test(name)) throw Error('table name'); return [name, f.database.prepare('SELECT * FROM ' + name).all()]; });
    const before = state();
    const result = f.operations.inspectObligation({ invocation, obligationId: 'original' }, f.peer);
    const obligation = f.database.prepare('SELECT attempt_epoch,active_attempt,definition_json FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(json(f.owner), 'original') as { attempt_epoch: number; active_attempt: string; definition_json: string };
    expect(result).toMatchObject({ owner: f.owner, obligationId: 'original', attemptEpoch: obligation.attempt_epoch, activeAttemptId: obligation.active_attempt, definitionHash: JSON.parse(obligation.definition_json).definitionHash, application: { state: 'active', current: { binding: { kind: 'loop' } } } });
    expect(result.attemptEpoch).toBe(1);
    expect(state()).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
  } finally { await f.close(); }
});

it('exposes the same exact observation through the signed controller and fixed verification transport', async () => {
  const f = await verifiedOperationFixture('loop-application'), socketPath = join(f.root, 'observer.sock');
  const unused = (): never => { throw Error('unexpected mutation'); };
  let renewals = 0;
  const routing = createControllerOperationRouting({ assertCurrent() {}, async renew() { renewals++; }, verification: f.operations, completion: f.composition.public,
    publication: { prepare: unused, approve: unused, reconcile: unused, recoverExpired: unused, observeOwner: unused, readOwnerPayload: unused }, execution: { invoke: unused } });
  const controller = await startPublicController({ socketPath, authorityId: 'authority', serviceEpoch: 'boot', privateKey: f.keys.privateKey, allowedUserIds: [f.peer.uid], acceptPeer: () => f.peer, invoke: routing.invoke });
  const client = createAuthenticatedControllerClient({ authorityId: 'authority', publicKey: f.keys.publicKey, roundTrip: (bytes, signal) => callControllerIpc(socketPath, bytes, { signal }), roundTripSync: unused });
  try {
    const query = { invocation, obligationId: 'original' };
    expect(await client.verificationTransport.call('verification.inspectObligation', query)).toEqual(f.operations.inspectObligation(query, f.peer));
    expect(renewals).toBe(0);
    await expect(client.verificationTransport.call('verification.inspectObligation', { ...query, owner: f.owner })).rejects.toThrow('verification_observation_shape');
    expect(f.database.prepare('SELECT COUNT(*) n FROM verification_operations').get()).toEqual({ n: 1 });
  } finally { client.dispose(); await controller.close(); await f.close(); }
});

it.each(['peer', 'invocation', 'obligation', 'extra'] as const)('denies an unregistered %s observation instead of accepting a caller owner', async kind => {
  const f = await verifiedOperationFixture('loop-application');
  try {
    const request = { invocation: kind === 'invocation' ? { ...invocation, validationInvocationId: 'foreign' } : invocation, obligationId: kind === 'obligation' ? 'foreign' : 'original', ...(kind === 'extra' ? { owner: f.owner } : {}) };
    expect(typeof f.operations.inspectObligation).toBe('function');
    expect(() => f.operations.inspectObligation(request, kind === 'peer' ? { ...f.peer, uid: 502 } : f.peer)).toThrow();
  } finally { await f.close(); }
});

it('does not return a guessed epoch for a missing or inconsistent active attempt', async () => {
  const f = await verifiedOperationFixture('loop-application');
  try {
    expect(typeof f.operations.inspectObligation).toBe('function');
    f.database.prepare('UPDATE mandatory_observation_checks SET attempt_epoch=attempt_epoch+1 WHERE owner_key=?').run(json(f.owner));
    expect(() => f.operations.inspectObligation({ invocation, obligationId: 'original' }, f.peer)).toThrow();
  } finally { await f.close(); }
});
it.each(['task','intent','goal','project'] as const)('reads actual native-added %s obligation at epoch zero without guessing or preparing',async(ownerKind)=>{
 const f=await verifiedOperationFixture('loop-application');try{
  const recipe=f.composition.privateHost.enrollment.readApprovedRecipe(f.owner,'original');const compiled=f.composition.privateHost.recipes.compile(recipe);
  const otherInvocation={sessionIdentity:'new-session-'+ownerKind,compoundOperationId:'new-op',validationInvocationId:'new-validation'},enrollment={ownerKind,ownerId:'new-'+ownerKind,invocations:[otherInvocation]};
  const registration={migrationEpoch:1,source:{kind:'new-owner'},obligations:[{obligation:{obligationId:'new-obligation',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe}]};
  const prepared=await f.composition.public.invoke('completion.prepare-owner',{enrollment,registration},f.peer) as {challengeId:string};
  const approved=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.peer) as {owner:{profileId:string;ownerKind:typeof ownerKind;ownerId:string}};
  expect(f.operations.inspectObligation({invocation:otherInvocation,obligationId:'new-obligation'},f.peer)).toEqual({owner:approved.owner,obligationId:'new-obligation',definitionHash:compiled.definitionHash,attemptEpoch:0,activeAttemptId:null,application:{state:'unbound',current:null,pendingTransitionId:null}});
  expect(f.database.prepare('SELECT COUNT(*) n FROM verification_operations').get()).toEqual({n:1});
 }finally{await f.close();}
});

it('operation closed from actual late owner clock cannot return a current observation',async()=>{
 let observationClockHook:(()=>void)|undefined;const setObservationClockHook=(hook?:()=>void)=>{observationClockHook=hook;};
 const query={invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},obligationId:'original'};
 let calls=0;const first=await verifiedOperationFixture('loop-application',{onClock:()=>observationClockHook?.()});setObservationClockHook(()=>{calls++;});try{first.operations.inspectObligation(query,first.peer);}finally{setObservationClockHook();await first.close();}
 const returned:number[]=[];
 for(let index=1;index<=calls;index++){const f=await verifiedOperationFixture('loop-application',{onClock:()=>observationClockHook?.()});let count=0,closed=false,drain:Promise<void>|undefined;setObservationClockHook(()=>{if(++count===index){closed=true;drain=f.operations.close();}});try{let observed=false;try{f.operations.inspectObligation(query,f.peer);observed=true;}catch{}if(closed&&observed)returned.push(index);}finally{setObservationClockHook();await drain;await f.close();}}
 expect(returned).toEqual([]);
},60000);
