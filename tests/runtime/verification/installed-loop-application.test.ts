import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ route: {} as any, review: {} as any, current: {} as any, calls: [] as string[], committed: false, dispose: 0, changeRoute: false, requestReply: undefined as any }));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({ readInstalledCurrentOwner: () => f.route }));
vi.mock('../../../src/runtime/verification/controller-client.js', () => ({ createInstalledVerificationClient: () => ({
  dispose() { f.dispose++; }, applicationTransport: { async call(method: string) {
    f.calls.push(method); if (method.endsWith('Request')) return f.requestReply; if (f.changeRoute) f.route = { kind: 'unavailable' };
    if (method === 'application.prepare') return { challengeId: f.review.challengeId, canonicalReview: f.review, alreadyCommitted: f.committed };
    return { state: 'active', current: f.current, pendingTransitionId: null, ...(method === 'application.inspect' ? { pendingTarget: null } : {}) };
  } },
}) }));
import { createInstalledLoopApplicationClient } from '../../../src/runtime/verification/installed-loop-application.js';
import { createLoopApplicationBinding, loopApplicationBindingHash } from '../../../src/runtime/verification/loop-application-binding.js';
import { loopHostSubjectOwner } from '../../../src/runtime/verification/loop-host-subject.js';
const binding = createLoopApplicationBinding({ version: 1, kind: 'loop',
 subject: {kind:'loop-run',loopId:'personal-assistant-morning-briefing',runId:'run',stage:null},
 candidateId:'candidate',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,
 contract:{version:1,kind:'assistant',assistantKind:'morning',profileId:'default-personal-assistant',locale:'zh',timeZone:'Asia/Shanghai',dataScopes:['threads'],objective:'整理建议',completionCriterion:'内容符合原来源'},
 body:{kind:'assistant-morning',recommendations:[{title:'查看事项',reasonCode:'due',evidenceRefs:[{kind:'task',id:'task'}]}],artifacts:[]},
});
const changed = (patch:Record<string,unknown>) => { const {triggerHash,contractHash,candidatePayloadHash,...base}=binding; return createLoopApplicationBinding({...base,...patch}); };
beforeEach(() => {
  const owner = { profileId: 'profile', ...loopHostSubjectOwner(binding.subject) }; f.route = { kind: 'protected-unregistered', authorityId: 'authority', owner };
  f.review = { version: 1, purpose: 'completion-application-binding', authorityId: 'authority', challengeId: 'challenge', principal: { uid: 501, auditSessionId: 7, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555' }, requestSource: 'user', owner, registrationHash: 'a'.repeat(64), previousBindingHash: null, binding, bindingHash: loopApplicationBindingHash(binding), deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 1000 } };
  f.current = { binding, bindingHash: loopApplicationBindingHash(binding), revision: 1 }; f.calls = []; f.committed = false; f.dispose = 0; f.changeRoute = false; f.requestReply = undefined;
});
it('only user can prepare/authorize; copied challenge can reconcile but never replay native approval', async () => {
  const user = createInstalledLoopApplicationClient(binding, 'user');
  try { const challenge = await user.prepare(), copy = structuredClone(challenge);
    await expect(user.authorize(copy)).rejects.toThrow(/challenge/);
    expect((await user.reconcile(copy)).state).toBe('active');
    expect((await user.authorize(challenge)).state).toBe('active');
    await expect(user.authorize(challenge)).rejects.toThrow(/challenge/);
    expect(f.calls).toEqual(['application.prepare', 'application.reconcile', 'application.authorize']);
  } finally { user.dispose(); }
  for (const source of ['agent', 'scheduler'] as const) {
    const reader = createInstalledLoopApplicationClient(binding, source);
    try { await expect(reader.prepare()).rejects.toThrow(/source/); expect((await reader.inspect()).current?.binding).toEqual(binding); }
    finally { reader.dispose(); }
  }
});
it('rejects changed original binding, foreign authority or route drift at the actual client boundary', async () => {
  const user = createInstalledLoopApplicationClient(binding, 'user');
  try {
    f.review.authorityId = 'foreign'; await expect(user.prepare()).rejects.toThrow(/binding/); f.review.authorityId = 'authority';
    f.review.binding = changed({candidateRevision:2}); f.review.bindingHash = loopApplicationBindingHash(f.review.binding);
    await expect(user.prepare()).rejects.toThrow(/binding/);
    f.review.binding = binding; f.review.bindingHash = loopApplicationBindingHash(binding); f.changeRoute = true;
    await expect(user.prepare()).rejects.toThrow(/changed/);
  } finally { user.dispose(); }
  await expect(user.inspect()).rejects.toThrow(/changed/);
});
it('idempotent prepared committed records are recovery facts and cannot issue another native request', async () => {
  f.committed = true; const user = createInstalledLoopApplicationClient(binding, 'user');
  try { const original = await user.prepare(); await expect(user.authorize(original)).rejects.toThrow(/challenge/);
    expect((await user.reconcile(original)).current?.binding).toEqual(binding);
    expect(f.calls).toEqual(['application.prepare','application.reconcile']);
  } finally { user.dispose(); }
});
it('requires a fixed protected owner route and validates strict pending/current observations', async () => {
  for (const kind of ['ordinary', 'pending', 'unavailable']) { f.route = { kind }; expect(() => createInstalledLoopApplicationClient(binding, 'user')).toThrow(/unavailable/); }
});
it('only a newly prepared request object can initiate native, never duplicate or recovered request facts',async()=>{
 const user=createInstalledLoopApplicationClient(binding,'user');
 const challenge={challengeId:f.review.challengeId,canonicalReview:f.review,alreadyCommitted:false};
 try{
  f.requestReply={created:true,challenge};const first=await user.prepareRequest('request');
  f.requestReply={created:false,challenge};const duplicate=await user.prepareRequest('request');
  f.requestReply={state:'pending',challengePhase:'prepared',challenge,observation:{state:'active',current:f.current,pendingTransitionId:null,pendingTarget:null}};
  const located=await user.lookupRequest('request');
  await expect(user.authorize(duplicate.challenge)).rejects.toThrow(/challenge/);
  await expect(user.authorize(located.challenge!)).rejects.toThrow(/challenge/);
  await expect(user.authorize(structuredClone(first.challenge))).rejects.toThrow(/challenge/);
  expect((await user.authorize(first.challenge)).state).toBe('active');
  f.requestReply={state:'not_prepared'};expect(await user.recoverRequest('missing')).toEqual({state:'not_prepared'});
 }finally{user.dispose();}
});
it('rejects malformed application request identities and inconsistent recovery state before it can guide the host',async()=>{
 const user=createInstalledLoopApplicationClient(binding,'user'),challenge={challengeId:f.review.challengeId,canonicalReview:f.review,alreadyCommitted:false};
 try{
  for(const id of ['', 'bad\nid','x'.repeat(161)])await expect(user.prepareRequest(id)).rejects.toThrow(/request/);
  expect(f.calls).toEqual([]);
  for(const result of [
   {state:'absent',challenge},
   {state:'not_approved',challengePhase:'approved',challenge},
   {state:'committed',challengePhase:'committed',challenge,observation:{state:'active',current:f.current,pendingTransitionId:null,pendingTarget:null}},
   {state:'pending',challengePhase:'invented',challenge,observation:{state:'active',current:f.current,pendingTransitionId:null,pendingTarget:null}},
  ]){f.requestReply=result;await expect(user.lookupRequest('request')).rejects.toThrow();}
 }finally{user.dispose();}
});
it('scheduler can locate and recover exact requests but cannot prepare a fresh native request',async()=>{
 const reader=createInstalledLoopApplicationClient(binding,'scheduler');try{
  await expect(reader.prepareRequest('request')).rejects.toThrow(/source/);
  f.requestReply={state:'absent'};expect(await reader.lookupRequest('request')).toEqual({state:'absent'});
  f.requestReply={state:'not_prepared'};expect(await reader.recoverRequest('request')).toEqual({state:'not_prepared'});
 }finally{reader.dispose();}
});

it('rejects Goal or a different actual run/stage in installed observations',async()=>{
 const reader=createInstalledLoopApplicationClient(binding,'user');try{
  const other=changed({subject:{...binding.subject,runId:'foreign'}});
  f.current={binding:other,bindingHash:loopApplicationBindingHash(other),revision:1};
  await expect(reader.inspect()).rejects.toThrow(/binding/);
  f.current={binding:{version:1,kind:'goal',goalId:'goal',sessionId:'session',epoch:1,objective:'goal',completionCriterion:null,expectedEvidenceKinds:[]},bindingHash:'a'.repeat(64),revision:1};
  await expect(reader.inspect()).rejects.toThrow();
 }finally{reader.dispose();}
});
it('captures the fixed actual subject and fails closed before transport on already aborted requests',async()=>{
 const reader=createInstalledLoopApplicationClient(binding,'user'), abort=new AbortController();abort.abort();
 try{await expect(reader.prepareRequest('request',abort.signal)).rejects.toThrow();expect(f.calls).toEqual([]);}finally{reader.dispose();}
});
