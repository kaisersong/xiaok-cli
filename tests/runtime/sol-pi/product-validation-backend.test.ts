import {it,expect,vi} from 'vitest';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductValidationBackend} from '../../../src/runtime/sol-pi/product-validation-backend.js';
it('binds real operation identity and final shell command to user authorization before wrapping a controller plan',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-validation-'))),hash='a'.repeat(64);
 try{
 const execution={} as any,materialAuthorization={} as any;
 const selectedResult={publicReceipt:{authorizationId:'grant',scopeDigest:hash,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}}};
 // The product authorizer returns an opaque object; a fabricated public receipt
 // must not be sufficient to acquire an isolated mount plan.
 const authorize=vi.fn(async()=>selectedResult),wrapPreparedValidationInput=vi.fn();
 const backend=createProductValidationBackend({workspaceRoot:root,expiresAt:Date.now()+60000,client:{execution,materialAuthorization,wrapPreparedValidationInput},authorize,assertCurrent:()=>{}});
 await expect(backend.prepareValidationInput({sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',editedFile:{path:join(root,'source.ts'),beforeHash:null,afterHash:hash},command:{command:'node verify.cjs',workdir:root}})).rejects.toThrow(/plan_missing/);
 expect(authorize.mock.calls[0][0]).toMatchObject({operation:{invocation:selectedResult.publicReceipt.invocation,exactCommand:{argv:['/bin/sh','-c','node verify.cjs'],cwdRelative:'.'},editedFile:{path:join(root,'source.ts'),afterHash:hash}}});
 expect(wrapPreparedValidationInput).not.toHaveBeenCalled();
 await expect(backend.prepareValidationInput({sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',editedFile:{path:join(root,'source.ts'),beforeHash:null,afterHash:hash},command:{command:'node verify.cjs',workdir:join(root,'..')}})).rejects.toThrow(/workspace/);
 expect(authorize).toHaveBeenCalledOnce();
 }finally{rmSync(root,{recursive:true,force:true});}
});
it.each(['same','different-operation','different-purpose'] as const)('consumes only the matching actual product authorization: %s',async scenario=>{
 const {authorizeProductValidationMaterials}=await import('../../../src/runtime/verification/product-material-authorization.js');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-validation-'))),hash='a'.repeat(64),invocation={sessionIdentity:'s',compoundOperationId:scenario==='different-operation'?'other':'o',validationInvocationId:'v'},command={argv:['/bin/sh','-c','node verify.cjs'],cwdRelative:'.'};
 try{
 const materialAuthorization={prepareMaterialAuthorization:vi.fn(async(draft:any)=>({challengeId:'c',canonicalReview:{...draft,materials:[{path:join(root,'source.ts'),byteLimit:10,size:1,sha256:hash}],scopeDigest:hash,engineBinding:{engineId:'engine',incarnation:'epoch'}}})),authorizeMaterialChallenge:vi.fn(async()=>({id:'g',secret:'test-only-grant-secret'})),prepareValidationInput:vi.fn(async()=>({mountPlanHandle:{id:'m',secret:'test-only-mount-secret'},invocation,command,scopeDigest:hash}))};
 const opaque=await authorizeProductValidationMaterials({requestSource:'user',draft:{purpose:scenario==='different-purpose'?'isolated-command':'isolated-validation',invocation,materials:[{path:join(root,'source.ts'),byteLimit:10}],exactCommand:command,...(scenario==='different-purpose'?{}:{editedFile:{path:join(root,'source.ts'),afterHash:hash}}),expiresAt:Date.now()+60000},client:materialAuthorization,review:async()=>{},assertCurrent:()=>{}});
 const testOnlyPlan={} as any,wrapPreparedValidationInput=vi.fn(()=>testOnlyPlan),backend=createProductValidationBackend({workspaceRoot:root,expiresAt:Date.now()+60000,client:{execution:{} as any,materialAuthorization,wrapPreparedValidationInput},authorize:async()=>opaque,assertCurrent:()=>{}});
 const run=backend.prepareValidationInput({sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',editedFile:{path:join(root,'source.ts'),beforeHash:null,afterHash:hash},command:{command:'node verify.cjs',workdir:root}});
 if(scenario==='same'){expect(await run).toMatchObject({materializedInput:testOnlyPlan,command,scopeDigest:hash});expect(wrapPreparedValidationInput).toHaveBeenCalledOnce();}
 else{await expect(run).rejects.toThrow(/authorization_mismatch/);expect(wrapPreparedValidationInput).not.toHaveBeenCalled();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('has a distinct direct-command authorization purpose without synthetic edit facts',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-validation-'))),authorize=vi.fn(async()=>null);
 try{
 const backend=createProductValidationBackend({workspaceRoot:root,expiresAt:Date.now()+60000,client:{execution:{} as any,materialAuthorization:{} as any,wrapPreparedValidationInput:vi.fn()},authorize,assertCurrent:()=>{}});
 await expect(backend.prepareDirectInput!({sessionIdentity:'s',operationId:'direct-op',validationInvocationId:'direct-op:command',command:{command:'node verify.cjs',workdir:root}})).rejects.toThrow(/cancelled/);
 expect(authorize.mock.calls[0][0]).toMatchObject({operation:{purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'direct-op',validationInvocationId:'direct-op:command'}}});
 expect((authorize.mock.calls[0][0] as any).operation).not.toHaveProperty('editedFile');
 }finally{rmSync(root,{recursive:true,force:true});}
});
