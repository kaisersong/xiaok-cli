import {describe,it,expect,vi} from 'vitest';
import {authorizeProductValidationMaterials,consumeProductValidationMaterials} from '../../../src/runtime/verification/product-material-authorization.js';
const digest='a'.repeat(64);
function fixture(){
 const invocation={sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'validation'};
 const draft={purpose:'isolated-validation' as const,invocation,materials:[{path:'/selected/source.ts',byteLimit:1000}],exactCommand:{argv:['node','verify.cjs'],cwdRelative:'.'},editedFile:{path:'/selected/source.ts',afterHash:digest},expiresAt:Date.now()+60000};
 const canonicalReview={...structuredClone(draft),materials:[{path:'/selected/source.ts',byteLimit:1000,sha256:digest,size:100}],engineBinding:{engineId:'engine',incarnation:'generation'},scopeDigest:digest};
 const client={prepareMaterialAuthorization:vi.fn(async(_request:unknown)=>({challengeId:'challenge',canonicalReview})),authorizeMaterialChallenge:vi.fn(async()=>({id:'grant',secret:'private-grant-secret'})),prepareValidationInput:vi.fn(async()=>({mountPlanHandle:{id:'mount',secret:'private-mount-secret'},command:canonicalReview.exactCommand,scopeDigest:digest,invocation}))};
 const review=vi.fn(async()=>{}),assertCurrent=vi.fn();
 return{draft,canonicalReview,client,review,assertCurrent};
}
describe('product validation material authorization',()=>{
 it('prepares and shows controller facts before requesting real OS authorization; does not mint from a Boolean',async()=>{
  const f=fixture();const result=await authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent});
  expect(f.review).toHaveBeenCalledWith(f.canonicalReview);
  expect(f.client.authorizeMaterialChallenge).toHaveBeenCalledWith('challenge',expect.any(Object));
  expect(f.review.mock.invocationCallOrder[0]).toBeLessThan(f.client.authorizeMaterialChallenge.mock.invocationCallOrder[0]);
  expect(f.client.prepareValidationInput).toHaveBeenCalledWith({grantHandle:{id:'grant',secret:'private-grant-secret'},invocation:f.draft.invocation},expect.any(Object));
  expect(result.publicReceipt).toEqual({authorizationId:'grant',scopeDigest:digest,invocation:f.draft.invocation});
  expect(JSON.stringify(result)).not.toContain('private-');
  expect(consumeProductValidationMaterials(result).mountPlanHandle.secret).toBe('private-mount-secret');
  expect(()=>consumeProductValidationMaterials(result)).toThrow(/consumed/);
  expect(()=>consumeProductValidationMaterials(JSON.parse(JSON.stringify(result)))).toThrow(/missing/);
 });
 it.each(['agent','scheduler'] as const)('denies %s before contacting a service',async requestSource=>{
  const f=fixture();await expect(authorizeProductValidationMaterials({requestSource,draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent})).rejects.toThrow(/user/);expect(f.client.prepareMaterialAuthorization).not.toHaveBeenCalled();
 });
 it('freezes the complete request before an asynchronous service call',async()=>{
  const f=fixture();f.client.prepareMaterialAuthorization.mockImplementation(async()=>{f.draft.exactCommand.argv[0]='evil';f.draft.materials[0].path='/unselected/secret';return{challengeId:'challenge',canonicalReview:f.canonicalReview};});
  await authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent});
  const sent=f.client.prepareMaterialAuthorization.mock.calls[0][0] as any;
  expect(sent.materials[0].path).toBe('/selected/source.ts');expect(sent.exactCommand.argv[0]).toBe('node');expect(Object.isFrozen(sent.materials)).toBe(true);
 });
 it('stops after cancellation or loss of the actual task owner',async()=>{
  const f=fixture(),abort=new AbortController();f.review.mockImplementation(async()=>abort.abort());
  await expect(authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent,signal:abort.signal})).rejects.toThrow();expect(f.client.authorizeMaterialChallenge).not.toHaveBeenCalled();
 });
 it('rejects extra selected files or altered command from challenge before showing an approval',async()=>{
  const f=fixture();f.canonicalReview.materials.push({path:'/unselected/secret',byteLimit:1000,sha256:digest,size:1});
  await expect(authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent})).rejects.toThrow(/challenge/);expect(f.client.authorizeMaterialChallenge).not.toHaveBeenCalled();
 });
 it('rejects stale requests, duplicate files and forged authority fields',async()=>{
  for(const change of [{expiresAt:1},{materials:[{path:'/selected/source.ts',byteLimit:1000},{path:'/selected/source.ts',byteLimit:1000}]},{approved:true}]){
   const f=fixture();await expect(authorizeProductValidationMaterials({requestSource:'user',draft:{...f.draft,...change},client:f.client,review:f.review,assertCurrent:f.assertCurrent})).rejects.toThrow();expect(f.client.prepareMaterialAuthorization).not.toHaveBeenCalled();
  }
 });
});
it.each(['wrong-command','wrong-invocation','wrong-scope'] as const)('does not expose a staged plan with %s',async variant=>{
 const f=fixture();f.client.prepareValidationInput.mockImplementation(async()=>({mountPlanHandle:{id:'mount',secret:'private-mount-secret'},command:variant==='wrong-command'?{argv:['evil'],cwdRelative:'.'}:f.draft.exactCommand,scopeDigest:variant==='wrong-scope'?'b'.repeat(64):digest,invocation:variant==='wrong-invocation'?{...f.draft.invocation,sessionIdentity:'another'}:f.draft.invocation}));
 await expect(authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent})).rejects.toThrow(/prepared_mismatch/);
});
it('stops after OS authorization when the host task is revoked, without staging',async()=>{
 const f=fixture();let revoked=false;f.client.authorizeMaterialChallenge.mockImplementation(async()=>{revoked=true;return{id:'grant',secret:'private-grant-secret'};});
 await expect(authorizeProductValidationMaterials({requestSource:'user',draft:f.draft,client:f.client,review:f.review,assertCurrent:()=>{if(revoked)throw Error('actual owner revoked');}})).rejects.toThrow('actual owner revoked');expect(f.client.prepareValidationInput).not.toHaveBeenCalled();
});
it('authorizes an explicitly selected direct command without inventing an edit',async()=>{
 const f=fixture(),{editedFile,...common}=f.draft,draft={...common,purpose:'isolated-command' as const};
 const {editedFile:ignored,...review}=f.canonicalReview;
 f.client.prepareMaterialAuthorization.mockImplementation(async()=>({challengeId:'challenge',canonicalReview:{...review,purpose:'isolated-command'} as any}));
 const result=await authorizeProductValidationMaterials({requestSource:'user',draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent});
 expect(result.publicReceipt.authorizationId).toBe('grant');expect(f.client.prepareMaterialAuthorization.mock.calls[0][0]).not.toHaveProperty('editedFile');
});
it('never treats missing edit facts as a compound validation or allows edit facts on a direct command',async()=>{
 const f=fixture(),{editedFile,...withoutEdit}=f.draft;
 for(const draft of [withoutEdit,{...f.draft,purpose:'isolated-command'}])await expect(authorizeProductValidationMaterials({requestSource:'user',draft,client:f.client,review:f.review,assertCurrent:f.assertCurrent})).rejects.toThrow();
 expect(f.client.prepareMaterialAuthorization).not.toHaveBeenCalled();
});

it('durable request mode never falls back to a client without request identity support',async()=>{
 const f=fixture(),beforeStep=vi.fn(async()=>{});
 await expect(authorizeProductValidationMaterials({...f,requestSource:'user',request:{requestId:'original',beforeStep}} as any)).rejects.toThrow();
 expect(f.client.prepareMaterialAuthorization).not.toHaveBeenCalled();expect(f.client.authorizeMaterialChallenge).not.toHaveBeenCalled();
});
it('journals the original request and each outbound step before sending and keeps the old private plan boundary',async()=>{
 const f=fixture(),order:string[]=[],facts:any[]=[];
 const client={...f.client,prepareMaterialAuthorizationRequest:vi.fn(async(input:any)=>{order.push('send:prepare');expect(input).toEqual({requestId:'original',draft:f.draft});return {requestId:'original',created:true,state:'mapped',challengeId:'challenge',challengePhase:'prepared',resources:[],canonicalReview:f.canonicalReview};})};
 client.authorizeMaterialChallenge.mockImplementation(async()=>{order.push('send:authorize');return{id:'grant',secret:'private-grant-secret'};});client.prepareValidationInput.mockImplementation(async()=>{order.push('send:stage');return{mountPlanHandle:{id:'mount',secret:'private-mount-secret'},command:f.draft.exactCommand,scopeDigest:digest,invocation:f.draft.invocation};});
 const result=await authorizeProductValidationMaterials({...f,client,requestSource:'user',request:{requestId:'original',async beforeStep(fact:any){order.push('journal:'+fact.phase);facts.push(fact);}}} as any);
 expect(order).toEqual(['journal:prepare','send:prepare','journal:authorize','send:authorize','journal:stage','send:stage']);
 expect(facts.every(fact=>fact.requestId==='original'&&Object.isFrozen(fact.draft))).toBe(true);expect(facts[1].challengeId).toBe('challenge');expect(client.prepareMaterialAuthorization).not.toHaveBeenCalled();
 expect(consumeProductValidationMaterials(result).mountPlanHandle.id).toBe('mount');expect(()=>consumeProductValidationMaterials(result)).toThrow();
});
it('a repeated durable request does not grant another native authorization',async()=>{
 const f=fixture(),client={...f.client,prepareMaterialAuthorizationRequest:vi.fn(async()=>({requestId:'original',created:false,state:'mapped',challengeId:'challenge',challengePhase:'prepared',resources:[]}))};
 await expect(authorizeProductValidationMaterials({...f,client,requestSource:'user',request:{requestId:'original',beforeStep:async()=>{}}} as any)).rejects.toThrow();expect(client.authorizeMaterialChallenge).not.toHaveBeenCalled();expect(f.review).not.toHaveBeenCalled();
});
it.each(['prepare','authorize','stage'])('does not send the %s step when the real journal hook fails',async phase=>{
 const f=fixture(),client={...f.client,prepareMaterialAuthorizationRequest:vi.fn(async()=>({requestId:'original',created:true,state:'mapped',challengeId:'challenge',challengePhase:'prepared',resources:[],canonicalReview:f.canonicalReview}))};
 await expect(authorizeProductValidationMaterials({...f,client,requestSource:'user',request:{requestId:'original',async beforeStep(fact:any){if(fact.phase===phase)throw Error('journal failed');}}} as any)).rejects.toThrow('journal failed');
 expect(phase==='prepare'?client.prepareMaterialAuthorizationRequest:phase==='authorize'?client.authorizeMaterialChallenge:client.prepareValidationInput).not.toHaveBeenCalled();
});

function requestFixture(){const f=fixture();const client={...f.client,prepareMaterialAuthorizationRequest:vi.fn(async()=>({requestId:'original',created:true as const,state:'mapped' as const,challengeId:'challenge',challengePhase:'prepared' as const,resources:[],canonicalReview:f.canonicalReview}))};return {...f,client};}
it.each(['owner','hook'] as const)('keeps captured client, review, current, request ID and hook when the %s callback replaces the caller fields',async where=>{
 const f=requestFixture(),replacement=vi.fn(()=>{throw Error('replacement used');}),phases:string[]=[];let changed=false;
 const input:any={...f,requestSource:'user',request:{requestId:'original',async beforeStep(step:any){phases.push(step.phase);if(where==='hook')change();}},assertCurrent(){if(where==='owner')change();}};
 function change(){if(changed)return;changed=true;input.client={prepareMaterialAuthorization:replacement,prepareMaterialAuthorizationRequest:replacement,authorizeMaterialChallenge:replacement,prepareValidationInput:replacement};input.review=replacement;input.assertCurrent=replacement;input.request.requestId='changed';input.request.beforeStep=replacement;}
 const result=await authorizeProductValidationMaterials(input);expect(result.publicReceipt.authorizationId).toBe('grant');expect(phases).toEqual(['prepare','authorize','stage']);expect(f.client.prepareMaterialAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({requestId:'original'}),expect.anything());expect(f.review).toHaveBeenCalledTimes(1);expect(replacement).not.toHaveBeenCalled();
});
it('captures the original methods even when a hook mutates that same client object',async()=>{
 const f=requestFixture(),originalAuthorize=f.client.authorizeMaterialChallenge,originalStage=f.client.prepareValidationInput,changed=vi.fn(async()=>{throw Error('changed method');});
 const result=await authorizeProductValidationMaterials({...f,requestSource:'user',request:{requestId:'original',beforeStep:async()=>{f.client.authorizeMaterialChallenge=changed as any;f.client.prepareValidationInput=changed as any;}}});
 expect(result.publicReceipt.authorizationId).toBe('grant');expect(originalAuthorize).toHaveBeenCalledOnce();expect(originalStage).toHaveBeenCalledOnce();expect(changed).not.toHaveBeenCalled();
});
it('rejects a fresh result for another request before review or native authorization',async()=>{
 const f=requestFixture();f.client.prepareMaterialAuthorizationRequest.mockImplementation(async()=>({requestId:'other',created:true,state:'mapped',challengeId:'challenge',challengePhase:'prepared',resources:[],canonicalReview:f.canonicalReview}));
 await expect(authorizeProductValidationMaterials({...f,requestSource:'user',request:{requestId:'original',beforeStep:async()=>{}}})).rejects.toThrow('validation_material_request_not_fresh');expect(f.review).not.toHaveBeenCalled();expect(f.client.authorizeMaterialChallenge).not.toHaveBeenCalled();
});
it.each(['requestId','beforeStep'])('rejects request %s accessors without invoking them or sending',async key=>{
 const f=requestFixture(),get=vi.fn(()=>key==='requestId'?'original':async()=>{}),request:any={requestId:'original',beforeStep:async()=>{}};Object.defineProperty(request,key,{get,enumerable:true});
 await expect(authorizeProductValidationMaterials({...f,requestSource:'user',request})).rejects.toThrow('validation_material_invalid_request');expect(get).not.toHaveBeenCalled();expect(f.client.prepareMaterialAuthorizationRequest).not.toHaveBeenCalled();
});
it.each(['prepare','authorize','stage'])('checks an abort caused inside the original guard before sending %s',async phase=>{
 const f=requestFixture(),abort=new AbortController();let armed=false;await expect(authorizeProductValidationMaterials({...f,signal:abort.signal,requestSource:'user',request:{requestId:'original',beforeStep:async step=>{armed=step.phase===phase;}},assertCurrent(){if(armed)abort.abort(Error('guard abort'));}})).rejects.toThrow('guard abort');
 expect(phase==='prepare'?f.client.prepareMaterialAuthorizationRequest:phase==='authorize'?f.client.authorizeMaterialChallenge:f.client.prepareValidationInput).not.toHaveBeenCalled();
});
it('rejects an asynchronous current guard before any journal or request',async()=>{
 const f=requestFixture(),beforeStep=vi.fn(async()=>{});await expect(authorizeProductValidationMaterials({...f,requestSource:'user',request:{requestId:'original',beforeStep},assertCurrent:async()=>{}})).rejects.toThrow('validation_material_owner_guard_must_be_synchronous');expect(beforeStep).not.toHaveBeenCalled();expect(f.client.prepareMaterialAuthorizationRequest).not.toHaveBeenCalled();
});
it.each(['prepare','authorize','stage'])('rechecks signal after the journal-helper microtask return before sending %s',async phase=>{
 const f=requestFixture(),abort=new AbortController();let pending=false;await expect(authorizeProductValidationMaterials({...f,requestSource:'user',signal:abort.signal,request:{requestId:'original',beforeStep:async step=>{pending=step.phase===phase;}},assertCurrent(){if(pending){pending=false;queueMicrotask(()=>abort.abort(Error('microtask revoke')));}}})).rejects.toThrow('microtask revoke');expect(phase==='prepare'?f.client.prepareMaterialAuthorizationRequest:phase==='authorize'?f.client.authorizeMaterialChallenge:f.client.prepareValidationInput).not.toHaveBeenCalled();
});
