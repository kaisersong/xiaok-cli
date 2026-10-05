import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {createSessionExecutionAuthority,createSessionExecutionContext,acquireSessionStoreExecutionGuard} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createSessionExecutionChain,acquireSessionPublicationChain,acquireSessionExecutionChain,acquireSessionExecutionFactChain,getSessionExecutionAncestorLease,getHeldSessionExecutionChainPath} from '../../../src/ai/runtime/session-store/execution-chain.js';
const clean:Array<()=>void>=[];
afterEach(()=>{for(const f of clean.splice(0).reverse())f();});
function fixture(){const root=mkdtempSync(join(tmpdir(),'execution-chain-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const targets=['grandparent','parent','child'].map(sessionIdentity=>{const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});clean.push(()=>authority.dispose());return{root,sessionIdentity,authority};});return{root,targets};}
it('takes three real ancestor leases in fixed order and retains all through effect drain',async()=>{
 const {targets}=fixture(),seen:string[]=[];let chain:ReturnType<typeof createSessionExecutionChain>|undefined;
 for(const target of targets)chain=createSessionExecutionChain({target,parent:chain,validate:async()=>{seen.push(target.sessionIdentity);expect(()=>acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity)).toThrow();}});
 const acquired=await acquireSessionExecutionChain(chain!,{invocationId:'effect',kind:'direct-mutation'});expect(seen).toEqual(['grandparent','parent','child']);
 const rootLease=getSessionExecutionAncestorLease(acquired.childLease,targets[0]);rootLease.assertCurrent();
 expect(()=>getSessionExecutionAncestorLease({...acquired.childLease},targets[0])).toThrow();
 let complete!:()=>void;const pending=new Promise<void>(r=>complete=r);acquired.trackInFlight(pending);const releasing=acquired.releaseAfterDrain();
 for(const target of targets)expect(()=>acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity)).toThrow();complete();await releasing;
 for(const target of targets){const release=acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity);release();}
 expect(()=>getSessionExecutionAncestorLease(acquired.childLease,targets[0])).toThrow();
});
it('rejects repeated canonical session ancestors before taking any lock, including case aliases and forged parent',()=>{
 const {targets}=fixture(),parent=createSessionExecutionChain({target:targets[0]});
 expect(()=>createSessionExecutionChain({target:{...targets[0],sessionIdentity:'GRANDPARENT'},parent})).toThrow('duplicate');
 expect(()=>createSessionExecutionChain({target:targets[1],parent:{...parent}})).toThrow();
 const release=acquireSessionStoreExecutionGuard(targets[0].root,targets[0].sessionIdentity);release();
});
it('releases every real ancestor even when one actual SQLite close reports an error',async()=>{
 const {targets}=fixture();let chain:ReturnType<typeof createSessionExecutionChain>|undefined;
 for(const target of targets)chain=createSessionExecutionChain({target,parent:chain});
 const acquired=await acquireSessionExecutionChain(chain!,{invocationId:'close-failure',kind:'compound'});
 const Database=createRequire(import.meta.url)('better-sqlite3');const close=Database.prototype.close;let once=true;
 const spy=vi.spyOn(Database.prototype,'close').mockImplementation(function(this:any){const result=close.call(this);if(once){once=false;throw Error('injected-close-error');}return result;});
 try{await expect(acquired.releaseAfterDrain()).rejects.toThrow('injected-close-error');}
 finally{spy.mockRestore();}
 for(const target of targets){const release=acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity);release();}
});
it('holds no ancestor lease while the child waits outside an actual effect and releases partial acquisitions on rejected durable admission',async()=>{
 const {targets}=fixture();const parent=createSessionExecutionChain({target:targets[0]});
 const child=createSessionExecutionChain({target:targets[1],parent,validate:async()=>{throw Error('durable_admission_revoked');}});
 // Planning/SDK/UI lifetimes do not acquire leases. Only the explicit effect call does.
 const idle=await targets[0].authority.acquire({invocationId:'parent-recovery',kind:'recovery'});await idle.releaseAfterDrain();
 await expect(acquireSessionExecutionChain(child,{invocationId:'child-effect',kind:'direct-mutation'})).rejects.toThrow('durable_admission_revoked');
 // The separate host fact writer still needs all original locks after grant
 // revocation. It does not run execution validators or confer execution rights.
 const factual=await acquireSessionExecutionFactChain(child,{invocationId:'close-existing'});
 getSessionExecutionAncestorLease(factual.childLease,targets[0]).assertCurrent();
 for(const target of targets.slice(0,2))expect(()=>acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity)).toThrow();
 await factual.releaseAfterDrain();
 for(const target of targets.slice(0,2)){const release=acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity);release();}
});
it('a fresh process obtaining the now-idle ancestor lock cannot settle or erase a durable unknown operation',async()=>{
 const {spawn}=await import('node:child_process');const {resolve}=await import('node:path');
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const {createCompoundSessionJournal}=await import('../../../src/runtime/sol-pi/compound-session-journal.js');
 const {targets,root}=fixture(),target=targets[0],store=new FileSessionStore(root);
 await store.save({sessionId:target.sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const journal=createCompoundSessionJournal({store,root,sessionIdentity:target.sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});
 const lease=await target.authority.acquire({invocationId:'original',kind:'direct-mutation'});
 const created=await journal.createOrGetDirect({hostProviderInvocationId:'provider',originalToolUseId:'tool',inputHash:'a'.repeat(64),toolName:'write',permissionGeneration:0},lease);
 await journal.advanceDirect(created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease);await journal.advanceDirect(created.operation.id,{stage:'outcome_unknown',outcome:'unknown'},lease);await lease.releaseAfterDrain();
 const code=`import {pathToFileURL} from 'node:url';const base=process.argv[1],root=process.argv[2],id=process.argv[3];const a=await import(pathToFileURL(base+'/src/ai/runtime/session-store/execution-authority.ts'));const {FileSessionStore}=await import(pathToFileURL(base+'/src/ai/runtime/session-store/file-store.ts'));const {createCompoundSessionJournal}=await import(pathToFileURL(base+'/src/runtime/sol-pi/compound-session-journal.ts'));const authority=a.createSessionExecutionAuthority({root,sessionIdentity:'grandparent',hostContext:a.createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});const lease=await authority.acquire({invocationId:'recovery',kind:'recovery'});const j=createCompoundSessionJournal({store:new FileSessionStore(root),root,sessionIdentity:'grandparent',ownerId:'host',scopeId:'scope',requestSource:'user',assertCurrent:()=>{}});try{await j.advanceDirect(id,{stage:'settled',outcome:'completed',quiescence:'synchronous_file'},lease);process.stdout.write('WRONGLY_CLEARED');}catch{process.stdout.write('UNKNOWN_RETAINED');}finally{await lease.releaseAfterDrain();authority.dispose();}`;
 const output=await new Promise<string>((resolveOutput,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code,resolve('.'),root,created.operation.id],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',c=>c===0?resolveOutput(out):reject(Error(err)));});
 expect(output).toBe('UNKNOWN_RETAINED');expect((await store.load(target.sessionIdentity))!.compoundOperations!.directOperations![0].stage).toBe('outcome_unknown');
});

it('derives ancestry only from the exact held private chain, rejecting copied and separately minted paths',async()=>{
 const {targets}=fixture();const root=createSessionExecutionChain({target:targets[0]}),chain=createSessionExecutionChain({target:targets[1],parent:root});
 const scope=await acquireSessionExecutionChain(chain,{invocationId:'held-path',kind:'compound'});
 try{
  expect(getHeldSessionExecutionChainPath(chain,scope.childLease).map(row=>row.sessionIdentity)).toEqual(['grandparent','parent']);
  expect(()=>getHeldSessionExecutionChainPath({...chain},scope.childLease)).toThrow();
  expect(()=>getHeldSessionExecutionChainPath(chain,{...scope.childLease})).toThrow();
  const other=createSessionExecutionChain({target:targets[1],parent:root});
  expect(()=>getHeldSessionExecutionChainPath(other,scope.childLease)).toThrow();
 }finally{await scope.releaseAfterDrain();}
 expect(()=>getHeldSessionExecutionChainPath(chain,scope.childLease)).toThrow();
});

it('uses only the original publication validators under all original ancestor locks',async()=>{
 const {targets}=fixture();let parentLive=true;const seen:string[]=[];
 const parent=createSessionExecutionChain({target:targets[0],validate:()=>{if(!parentLive)throw Error('parent revoked');seen.push('root');}});
 const child=createSessionExecutionChain({target:targets[1],parent,validate:()=>{throw Error('turn not active');},validatePublication:()=>{seen.push('publication');for(const target of targets.slice(0,2))expect(()=>acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity)).toThrow();}});
 await expect(acquireSessionExecutionChain(child,{invocationId:'effect',kind:'compound'})).rejects.toThrow('turn not active');seen.length=0;
 const held=await acquireSessionPublicationChain(child,{invocationId:'published-history'});expect(seen).toEqual(['root','publication']);await held.releaseAfterDrain();
 parentLive=false;await expect(acquireSessionPublicationChain(child,{invocationId:'revoked'})).rejects.toThrow('parent revoked');
 await expect(acquireSessionPublicationChain({...child},{invocationId:'copy'})).rejects.toThrow();
 for(const target of targets.slice(0,2)){const release=acquireSessionStoreExecutionGuard(target.root,target.sessionIdentity);release();}
});
