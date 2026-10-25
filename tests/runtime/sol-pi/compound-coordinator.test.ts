import {bashTool} from '../../../src/ai/tools/bash.js';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';import {createCompoundExecutionCoordinator} from '../../../src/runtime/sol-pi/compound-execution-coordinator.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {createWriteTool} from '../../../src/ai/tools/write.js';import {createReadTool} from '../../../src/ai/tools/read.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
const clean:Array<()=>void>=[];afterEach(()=>{for(const f of clean.splice(0).reverse())f();});
async function setup(onPrompt?:any,wrap?:(tool:import('../../../src/types.js').Tool)=>import('../../../src/types.js').Tool,validationBackend?:import('../../../src/runtime/sol-pi/compound-validation.js').CompoundValidationBackend){const root=mkdtempSync(join(tmpdir(),'compound-owner-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const sessionId='sess_owner',store=new FileSessionStore(root);await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});clean.push(()=>authority.dispose());let authorized=true;const assertCurrent=()=>{if(!authorized)throw Error('test_host_grant_revoked');};const journal=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent});const permission=new PermissionManager({mode:onPrompt?'default':'auto'}),write=wrap?wrap(createWriteTool({cwd:root})):createWriteTool({cwd:root}),read=createReadTool({cwd:root});
 let assertGlobal=()=>{};const coordinator=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent,getPermissionRevision:()=>permission.getRevision(),readonlyTools:[read],fileTools:[write],validationBackend,commandTool:validationBackend?bashTool:undefined,captureGlobalSupervision:()=>{assertGlobal();return()=>assertGlobal();}});const registry=new ToolRegistry({permissionManager:permission,onPrompt,compoundExecution:coordinator},[write,read,...(validationBackend?[bashTool]:[])]);clean.push(()=>registry.dispose());const context={taskId:'task',session:(await store.load(sessionId))!,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'tool'};
 return{root,store,authority,journal,registry,context,permission,coordinator,setGlobalSupervision:(check:()=>void)=>{assertGlobal=check;},revoke:()=>{authorized=false;}};}
it('real registry duplicated delivery writes once, prompts once and returns the same durable operation',async()=>{
 const prompt=vi.fn(async()=>true);const f=await setup(prompt),file=join(f.root,'file');const input={file_path:file,content:'once'};
 const [a,b]=await Promise.all([f.registry.executeTool('write',input,f.context),f.registry.executeTool('write',input,f.context)]);expect(a).toBe(b);expect(prompt).toHaveBeenCalledTimes(1);expect(readFileSync(file,'utf8')).toBe('once');
 const ledger=(await f.store.load(f.context.session.sessionId))!.compoundOperations!;expect(ledger.directOperations).toHaveLength(1);expect(ledger.directOperations![0]).toMatchObject({stage:'settled',outcome:'completed',quiescence:'synchronous_file',fileFacts:{adapter:'synchronous-native-file-v1',path:file,beforeHash:null,afterHash:expect.stringMatching(/^[a-f0-9]{64}$/)}});
 await expect(f.registry.executeTool('write',{...input,content:'different'},f.context)).rejects.toThrow('dispatch_identity_conflict');expect(readFileSync(file,'utf8')).toBe('once');
});
it('approval runs outside the shared lock and revocation prevents native mutation',async()=>{
 let accept!:(v:boolean)=>void;let entered!:()=>void;const requested=new Promise<void>(r=>entered=r);const f=await setup(()=>{entered();return new Promise<boolean>(r=>accept=r);});const file=join(f.root,'file');const pending=f.registry.executeTool('write',{file_path:file,content:'bad'},f.context);await requested;
 const other=await f.authority.acquire({invocationId:'other',kind:'compaction'});await other.releaseAfterDrain();f.permission.setMode('plan');accept(true);expect(await pending).toMatch(/Error/);expect(existsSync(file)).toBe(false);
});
it('durable uncertain direct sibling blocks all mutations and a replaced readonly tool',async()=>{
 const f=await setup(),file=join(f.root,'file');const lease=await f.authority.acquire({invocationId:'crashed',kind:'direct-mutation'});
 try{const created=await f.journal.createOrGetDirect({hostProviderInvocationId:'old',originalToolUseId:'old',inputHash:'a'.repeat(64),toolName:'bash',permissionGeneration:0},lease);await f.journal.advanceDirect(created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease);}finally{await lease.releaseAfterDrain();}
 expect(await f.registry.executeTool('write',{file_path:file,content:'bad'},f.context)).toContain('unknown');expect(existsSync(file)).toBe(false);
 const execute=vi.fn(async()=> 'forbidden');f.registry.registerTool({definition:{name:'read',description:'forged',inputSchema:{type:'object',properties:{}}},permission:'auto',execute} as any);
 expect(await f.registry.executeTool('read',{},f.context)).toContain('unknown');expect(execute).not.toHaveBeenCalled();
});

it('rejects a target changed while the real approval UI was pending',async()=>{
 let approve!:(value:boolean)=>void;let entered!:()=>void;const asked=new Promise<void>(r=>entered=r);
 const f=await setup(()=>{entered();return new Promise<boolean>(r=>approve=r);}),file=join(f.root,'file');writeFileSync(file,'original');
 const result=f.registry.executeTool('write',{file_path:file,content:'approved replacement'},f.context);await asked;writeFileSync(file,'new external intent');approve(true);
 expect(await result).toContain('compound_file_precondition_changed');expect(readFileSync(file,'utf8')).toBe('new external intent');
});

it('dispose cancels an unresolved approval without waiting for UI or allowing a later write',async()=>{
 let approve!:(value:boolean)=>void;let entered!:()=>void;const asked=new Promise<void>(r=>entered=r);
 const f=await setup(()=>{entered();return new Promise<boolean>(r=>approve=r);}),file=join(f.root,'file');
 const pending=f.registry.executeTool('write',{file_path:file,content:'late'},f.context);const rejected=expect(pending).rejects.toThrow();await asked;
 await f.coordinator.dispose();await rejected;approve(true);await new Promise(r=>setImmediate(r));expect(existsSync(file)).toBe(false);
});

it('real sandbox expansion approval must not hold the session execution lease',async()=>{
 const {createSandboxPolicy}=await import('../../../src/platform/sandbox/policy.js');const {createSandboxEnforcer}=await import('../../../src/platform/sandbox/enforcer.js');const {applySandboxToTools}=await import('../../../src/platform/sandbox/tool-wrappers.js');
 const policy=createSandboxPolicy({pathAllowlist:['/not-this-test']});let entered!:()=>void;const asked=new Promise<void>(r=>entered=r);let approve!:()=>void;
 const f=await setup(undefined,tool=>applySandboxToTools([tool],createSandboxEnforcer(policy),{onSandboxDenied:async path=>{entered();await new Promise<void>(r=>approve=r);policy.expandAllowedPaths([path]);return{shouldProceed:true};}})[0]);
 const file=join(f.root,'file'),pending=f.registry.executeTool('write',{file_path:file,content:'approved'},f.context);await asked;
 let acquired=false;const other=f.authority.acquire({invocationId:'scope-approval-observer',kind:'compaction'}).then(async lease=>{acquired=true;await lease.releaseAfterDrain();});
 await new Promise(r=>setTimeout(r,20));const beforeApproval=acquired;approve();await pending;await other;
 expect(beforeApproval).toBe(true);expect(readFileSync(file,'utf8')).toBe('approved');
});

it('native terminal is durable but an unscoped projection writer cannot bypass the effect lease',async()=>{
 const f=await setup(),file=join(f.root,'file');let projected=false;
 const result=await f.registry.executeTool('write',{file_path:file,content:'committed'},{...f.context,
  projectObservationResult:async nativeResult=>{
   const durable=(await f.store.load(f.context.session.sessionId))!;
   expect(durable.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'completed'});
   // Use the same ordinary SessionStore barrier as the observation publisher;
   // a captured execution lease must not be smuggled into this separate writer.
   await f.store.save(durable);projected=true;return nativeResult;
  },
 });
 expect(result).toContain('database is locked');expect(projected).toBe(false);expect(readFileSync(file,'utf8')).toBe('committed');
});

it('fusion uses actual independent Registry approvals and native edit, journals identity before isolated dispatch',async()=>{
 let fixtureState:Awaited<ReturnType<typeof setup>>;const receipt={};let expected:any;const calls:string[]=[];
 const backend={prepareValidationInput:async(value:any)=>{expect(readFileSync(value.editedFile.path,'utf8')).toBe('edited');calls.push('stage');return{materializedInput:{} as any,command:{argv:['/bin/sh','-c',value.command.command],cwdRelative:'.'},scopeDigest:'e'.repeat(64)};},execution:{
  reserveExecution:async(value:any)=>{expected={sessionIdentity:value.sessionIdentity,compoundOperationId:value.compoundOperationId,validationInvocationId:value.validationInvocationId,executionIdentity:'engine-fusion',scopeDigest:value.scopeDigest};calls.push('reserve');return{expected,executionIdentity:expected.executionIdentity};},
  dispatchExecution:async()=>{const ledger=(await fixtureState.store.load(fixtureState.context.session.sessionId))!.compoundOperations!;expect(ledger.operations[0]).toMatchObject({stage:'validation_started',physicalExecution:expected});calls.push('dispatch');return{termination:'terminal' as const,receipt:receipt as any,exitCode:2,outputTruncated:false};},
  inspectExecution:vi.fn(),assertQuiescent:(actual:any)=>{expect(actual).toBe(receipt);calls.push('receipt');},
 }};
 const prompt=vi.fn(async()=>true);fixtureState=await setup(prompt,undefined,backend);const f=fixtureState,file=join(f.root,'fusion-file');
 const result=await f.registry.executeTool('write',{file_path:file,content:'edited',then_run:{command:'exit 2',workdir:f.root}},f.context);
 expect(result).toContain('edit=succeeded; validation=failed; exitCode=2');expect(readFileSync(file,'utf8')).toBe('edited');expect(prompt).toHaveBeenCalledTimes(2);expect(calls).toEqual(['stage','reserve','dispatch','receipt']);
 const record=(await f.store.load(f.context.session.sessionId))!.compoundOperations!.operations[0];expect(record).toMatchObject({stage:'settled',editStatus:'succeeded',validation:{status:'failed',exitCode:2}});
 await f.registry.executeTool('write',{file_path:file,content:'edited',then_run:{command:'exit 2',workdir:f.root}},f.context);expect(calls).toHaveLength(4);
});

function validationContractBackend(){
 let expected:any;const receipt={};
 return{prepareValidationInput:vi.fn(async(value:any)=>({materializedInput:{} as any,command:{argv:['/bin/sh','-c',value.command.command],cwdRelative:'.'},scopeDigest:'f'.repeat(64)})),execution:{
  reserveExecution:vi.fn(async(value:any)=>{expected={sessionIdentity:value.sessionIdentity,compoundOperationId:value.compoundOperationId,validationInvocationId:value.validationInvocationId,executionIdentity:'engine-contract',scopeDigest:value.scopeDigest};return{expected,executionIdentity:expected.executionIdentity};}),
  dispatchExecution:vi.fn(async()=>({termination:'terminal' as const,receipt:receipt as any,exitCode:0,outputTruncated:false})),
  inspectExecution:vi.fn(),assertQuiescent:vi.fn((actual:any,identity:any)=>{expect(actual).toBe(receipt);expect(identity).toEqual(expected);}),
 }};
}
it('a separately cancelled validator preserves the real approved edit and never stages or dispatches',async()=>{
 const backend=validationContractBackend(),f=await setup(async(name:string)=>name==='write',undefined,backend),file=join(f.root,'denied-validator');
 const result=await f.registry.executeTool('write',{file_path:file,content:'keep',then_run:{command:'exit 2',workdir:f.root}},f.context);
 expect(result).toContain('edit=succeeded; validation=cancelled');expect(readFileSync(file,'utf8')).toBe('keep');expect(backend.prepareValidationInput).not.toHaveBeenCalled();expect(backend.execution.dispatchExecution).not.toHaveBeenCalled();
});
it('material approval is outside the shared lease and a later real edit invalidates the old validation',async()=>{
 const backend=validationContractBackend();const prepare=backend.prepareValidationInput.getMockImplementation()!;let approve!:()=>void,entered!:()=>void;const asked=new Promise<void>(r=>entered=r);
 backend.prepareValidationInput.mockImplementation(async value=>{entered();await new Promise<void>(r=>approve=r);return prepare(value);});
 const f=await setup(undefined,undefined,backend),file=join(f.root,'material-pending');
 const pending=f.registry.executeTool('write',{file_path:file,content:'first',then_run:{command:'exit 0',workdir:f.root}},f.context);await asked;
 expect(readFileSync(file,'utf8')).toBe('first');
 await f.registry.executeTool('write',{file_path:file,content:'new intent'},{...f.context,toolInvocationId:'new-tool'});
 approve();expect(await pending).toContain('changed while validation materials were approved');expect(readFileSync(file,'utf8')).toBe('new intent');expect(backend.execution.dispatchExecution).not.toHaveBeenCalled();
});
it('unknown validation blocks sibling mutations but leaves the actual builtin read usable',async()=>{
 const backend=validationContractBackend();backend.execution.dispatchExecution.mockResolvedValue({termination:'unknown',exitCode:null,outputTruncated:false} as any);
 const f=await setup(undefined,undefined,backend),file=join(f.root,'unknown');
 expect(await f.registry.executeTool('write',{file_path:file,content:'keep',then_run:{command:'exit 0',workdir:f.root}},f.context)).toContain('validation=unknown');
 expect(await f.registry.executeTool('write',{file_path:file,content:'unsafe'},{...f.context,toolInvocationId:'sibling'})).toContain('unknown');expect(readFileSync(file,'utf8')).toBe('keep');
 f.setGlobalSupervision(()=>{throw Error('compound_tree_actual_unknown');});
 expect(await f.registry.executeTool('read',{file_path:file},{...f.context,toolInvocationId:'readonly'})).toContain('keep');
 expect((await f.store.load(f.context.session.sessionId))!.compoundOperations!.operations[0].stage).toBe('outcome_unknown');
 const forged=vi.fn(async()=> 'forged');f.registry.registerTool({definition:{name:'read',description:'fake readonly',inputSchema:{type:'object',properties:{}}},permission:'auto',execute:forged} as any);
 await expect(f.registry.executeTool('read',{file_path:file},{...f.context,toolInvocationId:'forged-read'})).rejects.toThrow('compound_tree_actual_unknown');expect(forged).not.toHaveBeenCalled();
});
it('only a bound validation backend advertises then_run and replacing actual native bash cannot inherit it',async()=>{
 const plain=await setup();expect(plain.registry.getToolDefinitions().find(d=>d.name==='write')!.inputSchema.properties).not.toHaveProperty('then_run');
 const backend=validationContractBackend(),f=await setup(undefined,undefined,backend),file=join(f.root,'not-written');expect(f.registry.getToolDefinitions().find(d=>d.name==='write')!.inputSchema.properties).toHaveProperty('then_run');
 f.registry.registerTool({...bashTool,execute:vi.fn(async()=> 'forged')});
 await expect(f.registry.executeTool('write',{file_path:file,content:'bad',then_run:{command:'exit 0'}},f.context)).rejects.toThrow('compound_native_command_adapter_changed');expect(existsSync(file)).toBe(false);
});
it('direct native bash uses a direct journal and explicit command materials without inventing an edited file',async()=>{
 const backend={...validationContractBackend(),prepareDirectInput:vi.fn(async(value:any)=>({materializedInput:{} as any,command:{argv:['/bin/sh','-c',value.command.command],cwdRelative:'.'},scopeDigest:'f'.repeat(64)}))};
 const f=await setup(undefined,undefined,backend);
 const result=await f.registry.executeTool('bash',{command:'printf unsafe > host-marker',workdir:f.root},f.context);
 expect(result).not.toContain('Error:');expect(existsSync(join(f.root,'host-marker'))).toBe(false);
 expect(backend.prepareDirectInput).toHaveBeenCalledTimes(1);expect(backend.prepareDirectInput.mock.calls[0][0]).not.toHaveProperty('editedFile');
 expect(backend.prepareValidationInput).not.toHaveBeenCalled();const ledger=(await f.store.load(f.context.session.sessionId))!.compoundOperations!;
 expect(ledger.operations).toEqual([]);expect(ledger.directOperations![0]).toMatchObject({toolName:'bash',stage:'settled',outcome:'completed',quiescence:'isolated_tree'});
 await f.registry.executeTool('bash',{command:'printf unsafe > host-marker',workdir:f.root},f.context);expect(backend.execution.dispatchExecution).toHaveBeenCalledTimes(1);
});
it('direct command unknown is recorded once, returns an explicit error and remains a sibling mutation gate',async()=>{
 const backend={...validationContractBackend(),prepareDirectInput:vi.fn(async(value:any)=>({materializedInput:{} as any,command:{argv:['/bin/sh','-c',value.command.command],cwdRelative:'.'},scopeDigest:'f'.repeat(64)}))};
 backend.execution.dispatchExecution.mockResolvedValue({termination:'unknown',exitCode:null,outputTruncated:false} as any);
 const f=await setup(undefined,undefined,backend);
 const result=await f.registry.executeTool('bash',{command:'echo uncertain',workdir:f.root},f.context);
 expect(result).toMatch(/^Error:/);expect(result).toContain('unknown');
 expect((await f.store.load(f.context.session.sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'outcome_unknown',outcome:'unknown',quiescence:null});
 expect(await f.registry.executeTool('write',{file_path:join(f.root,'blocked'),content:'no'},{...f.context,toolInvocationId:'next'})).toContain('unknown');
 expect(existsSync(join(f.root,'blocked'))).toBe(false);expect(backend.execution.dispatchExecution).toHaveBeenCalledTimes(1);
});

for(const fusion of [false,true])it(`native directory precondition failure settles the original never-started ${fusion?'fusion':'direct'} record`,async()=>{
 const backend=validationContractBackend(),f=await setup(undefined,undefined,backend);
 await expect(f.registry.executeTool('write',{file_path:f.root,content:'must not write',...(fusion?{then_run:{command:'exit 0'}}:{})},f.context)).rejects.toThrow();
 const ledger=(await f.store.load(f.context.session.sessionId))!.compoundOperations!;
 expect(fusion?ledger.operations[0]:ledger.directOperations![0]).toMatchObject(fusion?{stage:'settled',editStatus:'failed',validation:{status:'not_started'}}:{stage:'settled',outcome:'invalid'});
 expect(backend.execution.dispatchExecution).not.toHaveBeenCalled();
});

it('fusion cancelled during real approval durably closes its never-started preparation',async()=>{
 let entered!:()=>void,accept!:(v:boolean)=>void;const asked=new Promise<void>(r=>entered=r),backend=validationContractBackend();
 const f=await setup(()=>{entered();return new Promise<boolean>(r=>accept=r);},undefined,backend),file=join(f.root,'never-started');
 const pending=f.registry.executeTool('write',{file_path:file,content:'late',then_run:{command:'exit 0'}},f.context);
 const rejected=expect(pending).rejects.toThrow();await asked;await f.coordinator.dispose();await rejected;accept(true);
 expect((await f.store.load(f.context.session.sessionId))!.compoundOperations!.operations[0]).toMatchObject({stage:'settled',editStatus:'cancelled',validation:{status:'not_started'}});
 expect(existsSync(file)).toBe(false);expect(backend.execution.dispatchExecution).not.toHaveBeenCalled();
});

it('revocation during material approval retains the durable edit and closes only the undispatched validation',async()=>{
 const backend=validationContractBackend();let entered!:()=>void,reject!:(error:Error)=>void;const asked=new Promise<void>(r=>entered=r);
 backend.prepareValidationInput.mockImplementation(async()=>{entered();return new Promise((_,r)=>reject=r);});
 const f=await setup(undefined,undefined,backend),file=join(f.root,'committed-before-revoke');
 const pending=f.registry.executeTool('write',{file_path:file,content:'keep edit',then_run:{command:'exit 0'}},f.context).catch(error=>String(error));
 await asked;expect(readFileSync(file,'utf8')).toBe('keep edit');f.revoke();reject(Error('user revoked material grant'));await pending;
 expect((await f.store.load(f.context.session.sessionId))!.compoundOperations!.operations[0]).toMatchObject({stage:'settled',editStatus:'succeeded',validation:{status:'denied',exitCode:null}});
 expect(readFileSync(file,'utf8')).toBe('keep edit');expect(backend.execution.dispatchExecution).not.toHaveBeenCalled();
});


it('physical disposal preserves an arbitrary original journal rejection after abort, even with an AbortError lookalike', async () => {
 const f=await setup(),file=join(f.root,'file');writeFileSync(file,'original');
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
 const failure=new DOMException('Compound owner disposed','AbortError');
 vi.spyOn(f.store,'load').mockImplementationOnce(async()=>{enter();await gate;throw failure;});
 const original=f.registry.executeTool('read',{file_path:file},f.context);
 const observed=expect(original).rejects.toBe(failure);await entered;
 const disposal=f.coordinator.dispose();let settled=false;
 void disposal.then(()=>{settled=true;},()=>{settled=true;});
 await Promise.resolve();expect(settled).toBe(false);release();await observed;
 await expect(disposal).rejects.toMatchObject({errors:[failure]});
 expect(f.coordinator.dispose()).toBe(disposal);
});
