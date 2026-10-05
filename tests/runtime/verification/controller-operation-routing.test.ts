import {createStableQualificationRefresh} from '../../../src/runtime/verification/native-approval-refresh.js';
import {it,expect} from 'vitest';import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
it.each(['verification.prepare','verification.dispatch','publication.prepare','publication.approve','publication.reconcile','publication.recoverExpired','publication.observeIntentDependencies','publication.observeLoopSet','publication.observeOwner','publication.readOwnerPayload'] as const)('revalidates the original engine before %s and never dispatches a changed binding',async(method)=>{
 let binding='engine-a',calls=0,renewals=0;const deadline=40;
 const renew=createStableQualificationRefresh({async ensureCurrent(){renewals++;},readBinding:()=>({engineId:binding,incarnation:'same'}),assertCurrent(){}});
 const router=createControllerOperationRouting({assertCurrent(){},renew,publication:{async observeIntentDependencies(){calls++;},async observeLoopSet(){calls++;},async readOwnerPayload(){calls++;},async observeOwner(){calls++;},async recoverExpired(){calls++;},prepare(){calls++;},async approve(){calls++;},async reconcile(){calls++;}},verification:{async prepare(){calls++;},async dispatch(){calls++;}},completion:{invoke(){throw Error('not completion');}},execution:{async invoke(){throw Error('not execution');}}});
 const peer={uid:501,gid:20,auditSessionId:1};await router.invoke(method,{deadline},peer,new AbortController().signal);expect(calls).toBe(1);binding='engine-b';await expect(router.invoke(method,{deadline},peer,new AbortController().signal)).rejects.toThrow('installed_controller_engine_changed');expect(calls).toBe(1);expect(renewals).toBe(2);expect(deadline).toBe(40);
});

const capturedMethods = [
 'completion.read-intent-contract', 'completion.read-goal-fork-source',
 'completion.prepare-owner-request', 'completion.lookup-owner-request', 'completion.recover-owner-request',
 'completion.prepare-owner', 'completion.authorize-owner', 'completion.open-owner', 'completion.inspect',
 'completion.settle', 'completion.authorize', 'completion.receiver-challenge', 'completion.receiver-reply',
 'verification.prepare', 'verification.dispatch', 'publication.prepareRequest', 'publication.prepare',
 'publication.approve', 'publication.reconcile', 'publication.recoverExpired', 'publication.observeIntentDependencies','publication.observeLoopSet','publication.observeOwner', 'publication.readOwnerPayload',
] as const;
it.each(capturedMethods)('captures the original payload and peer before qualification renewal for %s', async method => {
 let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
 const calls: unknown[] = []; const capture = (payload: unknown, peer: unknown) => { calls.push({payload, peer}); };
 const asyncCapture = async (payload: unknown, peer: unknown) => capture(payload, peer);
 const router = createControllerOperationRouting({assertCurrent(){}, renew: () => barrier,
  publication: {prepareRequest:capture, prepare:capture, approve:asyncCapture, reconcile:asyncCapture,
   recoverExpired:asyncCapture, observeIntentDependencies:asyncCapture,observeLoopSet:asyncCapture, observeOwner:asyncCapture, readOwnerPayload:asyncCapture},
  verification: {prepare:asyncCapture, dispatch:asyncCapture},
  completion: {invoke(_method, payload, peer){ capture(payload, peer); }}, execution:{async invoke(){ throw Error('unexpected_execution'); }} });
 const payload = {requestId:'original', registration:{obligations:['original']}}, peer = {uid:501,gid:20,auditSessionId:1};
 const original = structuredClone({payload,peer});
 const work = router.invoke(method,payload,peer,new AbortController().signal);
 payload.requestId = 'replacement'; payload.registration.obligations[0] = 'weaker'; peer.auditSessionId = 2;
 release(); await work; expect(calls).toEqual([original]);
});
it.each(['publication.recoverRequest','publication.lookupRequest','publication.recoverUnapproved','execution.reserve'] as const)('captures %s before synchronous lifecycle callbacks without changing its refresh policy', async method => {
 const payload = {requestId:'original'}, peer = {uid:501,gid:20,auditSessionId:1};
 const original = structuredClone({payload,peer}); let renewals = 0; const calls: unknown[] = [];
 const capture = (payload:unknown,peer:unknown) => { calls.push({payload,peer}); }; const asyncCapture = async (payload:unknown,peer:unknown) => capture(payload,peer);
 const router = createControllerOperationRouting({assertCurrent(){payload.requestId='replacement';peer.auditSessionId=2;},async renew(){renewals++;},
  publication:{recoverRequest:capture,lookupRequest:capture,recoverUnapproved:capture,prepare:capture,approve:asyncCapture,reconcile:asyncCapture,recoverExpired:asyncCapture,observeOwner:asyncCapture,readOwnerPayload:asyncCapture},
  verification:{prepare:asyncCapture,dispatch:asyncCapture},completion:{invoke(){throw Error('unexpected_completion');}},execution:{async invoke(_method,payload,peer){capture(payload,peer);}}});
 await router.invoke(method,payload,peer,new AbortController().signal); expect(calls).toEqual([original]);expect(renewals).toBe(0);
});
