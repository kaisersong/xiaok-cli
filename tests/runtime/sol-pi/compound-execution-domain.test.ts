import {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync,writeFileSync,realpathSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createObservationService} from '../../../src/runtime/sol-pi/observation-service.js';
import {createObservationSessionOwner} from '../../../src/runtime/sol-pi/observation-session-owner.js';
import {inspectCompoundSourceInventory} from '../../../src/runtime/sol-pi/compound-source-inventory.js';
import {openCompoundExecutionDomain,COMPOUND_DOMAIN_RESERVED_BYTES} from '../../../src/runtime/sol-pi/compound-execution-domain.js';

const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(reserve=true){
 const root=mkdtempSync(join(tmpdir(),'compound-domain-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const profileRoot=join(root,'profile'),storeRoot=join(root,'sessions');mkdirSync(storeRoot);
 const store=new FileSessionStore(storeRoot);
 const service=createObservationService({profileRoot,profileId:'host-fixed-profile',reservedProfileBytes:reserve?COMPOUND_DOMAIN_RESERVED_BYTES:0,redactor:{version:'test-domain-no-capture',redact(){throw Error('no capture in domain registration test');}}});
 cleanup.push(()=>service.dispose());
 function makeOwner(sessionId:string,cwd=root){
  const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId,cwd});
  const caller=service.bindCaller({sessionId,ownerAgentId:sessionId,scopeId:sessionId,permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
  const owner=createObservationSessionOwner({service,caller,session,destination:{provider:'fixture',model:'fixture',url:'https://example.test/v1/chat/completions'},persist:snapshot=>store.save(snapshot)});
  cleanup.push(()=>owner.dispose());return{owner,session};
 }
 const primary=makeOwner('canonical-domain-root');
 const authority=createSessionExecutionAuthority({root:storeRoot,sessionIdentity:primary.session.exportSnapshot().sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test-host',scopeId:'test-domain'})});cleanup.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'domain-init',kind:'recovery'});cleanup.push(()=>lease.releaseAfterDrain());
 return{root,profileRoot,storeRoot,service,makeOwner,authority,lease,inventory:inspectCompoundSourceInventory([storeRoot]),...primary};
}
it('derives profile identity from the real owner and keeps one immutable canonical root',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 expect(domain.getBinding()).toMatchObject({version:1,authorityId:f.service.authorityId,generation:1,canonicalSessionId:f.session.exportSnapshot().sessionId,storeRoot:realpathSync(f.storeRoot),state:'active'});
 expect(openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory}).getBinding()).toEqual(domain.getBinding());
 expect(()=>openCompoundExecutionDomain({owner:{} as never,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory})).toThrow();
});
it('retires a truly terminal root before allowing a fresh owner to publish the next generation',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 const store=new FileSessionStore(f.storeRoot),snapshot=f.session.exportSnapshot();
 await store.compareAndSave({expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot:snapshot,lease:f.lease});
 await store.registerSessionAlias({aliasId:'old-root-alias',holderRoot:realpathSync(f.root),holderId:'old-root',targetSessionId:snapshot.sessionId,domainInitializationId:domain.getBinding().initializationId,domainGeneration:1,requestSource:'user',lease:f.lease});
 await f.lease.releaseAfterDrain();
 expect(await (domain as any).retire({authority:f.authority})).toMatchObject({state:'retired',generation:1});
 const next=f.makeOwner('next-canonical-root');
 const authority=createSessionExecutionAuthority({root:f.storeRoot,sessionIdentity:'next-canonical-root',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'test-host',scopeId:'test-domain'})});
 const lease=await authority.acquire({invocationId:'next',kind:'recovery'});
 try{
  const second=openCompoundExecutionDomain({owner:next.owner,storeRoot:f.storeRoot,lease,inventory:inspectCompoundSourceInventory([f.storeRoot])});
  expect(second.getBinding()).toMatchObject({state:'active',generation:2,canonicalSessionId:'next-canonical-root'});
  expect(()=>domain.assertCurrent()).toThrow();
  second.close(lease);
 }finally{await lease.releaseAfterDrain();authority.dispose();}
});
it('keeps an unknown native effect fenced and refuses a new root after retirement cannot prove the tree terminal',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 const {createCompoundOperationLedger}=await import('../../../src/runtime/sol-pi/compound-operation.js');
 const {createOrGetDirectOperation,advanceDirectOperation}=await import('../../../src/runtime/sol-pi/compound-direct-operation.js');
 const created=createOrGetDirectOperation(createCompoundOperationLedger(),{dispatch:{sessionIdentity:f.session.exportSnapshot().sessionId,hostProviderInvocationId:'provider',originalToolUseId:'write'},inputHash:'a'.repeat(64),toolName:'write',ownerId:'owner',requestSource:'agent',scopeId:'scope',permissionGeneration:1});
 const started=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)});
 const unknown=advanceDirectOperation(started,created.operation.id,{stage:'outcome_unknown',outcome:'unknown'});
 const snapshot=f.session.exportSnapshot(),store=new FileSessionStore(f.storeRoot);
 await store.compareAndSave({expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot:{...snapshot,compoundOperations:unknown},lease:f.lease});await f.lease.releaseAfterDrain();
 await expect(domain.retire({authority:f.authority})).rejects.toThrow(/unsettled/);
 expect(JSON.parse(readFileSync(join(f.profileRoot,'compound-domains','index.json'),'utf8')).state).toBe('retiring');
 expect((await store.load(snapshot.sessionId))!.compoundOperations!.directOperations![0].stage).toBe('outcome_unknown');
 const next=f.makeOwner('forbidden-next'),authority=createSessionExecutionAuthority({root:f.storeRoot,sessionIdentity:'forbidden-next',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'scope'})}),lease=await authority.acquire({invocationId:'next',kind:'recovery'});
 try{expect(()=>openCompoundExecutionDomain({owner:next.owner,storeRoot:f.storeRoot,lease,inventory:inspectCompoundSourceInventory([f.storeRoot])})).toThrow();}finally{await lease.releaseAfterDrain();authority.dispose();}
});
it('another workspace or owner cannot choose a new root in an already registered profile',async()=>{
 const f=await fixture();openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const otherPath=join(f.root,'other-workspace');mkdirSync(otherPath);const other=f.makeOwner('new-root-bypass',otherPath);
 expect(()=>openCompoundExecutionDomain({owner:other.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory})).toThrow(/domain/);
});
it('a missing or corrupt index under an initialized namespace cannot lazily reset the root',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const index=join(f.profileRoot,'compound-domains','index.json'),bytes=readFileSync(index,'utf8');
 rmSync(index);expect(()=>domain.assertCurrent()).toThrow();
 expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory})).toThrow();
 writeFileSync(index,'{broken');expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory})).toThrow();
 writeFileSync(index,bytes);domain.assertCurrent();
});
it('requires the host reserved profile budget before creating the durable namespace',async()=>{
 const f=await fixture(false);expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory})).toThrow(/budget/);
 expect(existsSync(join(f.profileRoot,'compound-domains'))).toBe(false);
});

it('a store path is a bound reference, never a domain output path, and must match the actual lease',async()=>{
 const f=await fixture(),foreign=join(f.root,'foreign-profile');mkdirSync(foreign);
 expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:foreign,lease:f.lease,inventory:f.inventory})).toThrow('compound_domain_root_lease_mismatch');
 expect(existsSync(join(foreign,'compound-domains'))).toBe(false);
 expect(existsSync(join(f.profileRoot,'compound-domains'))).toBe(false);
});

it('a replaced store directory cannot reuse an old live lease for a new effects domain',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 domain.assertForEffect(f.lease);
 renameSync(f.storeRoot,`${f.storeRoot}-old`);mkdirSync(f.storeRoot);
 expect(()=>domain.assertForEffect(f.lease)).toThrow(/domain/);
});

it('a replaced execution-lock directory cannot leave an old lease authorizing effects',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const locks=join(f.storeRoot,'.session-execution');renameSync(locks,`${locks}-old`);mkdirSync(locks);
 expect(()=>domain.assertForEffect(f.lease)).toThrow(/domain/);
});

it('fresh initialization requires an actual current inventory, not a caller boolean or copied report',async()=>{
 const f=await fixture();
 expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease})).toThrow(/inventory/);
 expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:{...f.inventory} as never})).toThrow(/inventory/);
 expect(existsSync(join(f.profileRoot,'compound-domains'))).toBe(false);
});

it('an old protected snapshot in another inventoried root blocks fresh domain publication',async()=>{
 const f=await fixture(),oldRoot=join(f.root,'legacy');mkdirSync(oldRoot);const store=new FileSessionStore(oldRoot);
 const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'legacy-protected',cwd:f.root});
 const authority=createSessionExecutionAuthority({root:oldRoot,sessionIdentity:'legacy-protected',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'legacy',scopeId:'legacy'})});
 const lease=await authority.acquire({invocationId:'legacy-init',kind:'recovery'});
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 try{const snapshot=session.exportSnapshot();await store.compareAndSave({expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest(snapshot),nextSnapshot:snapshot,lease});}finally{await lease.releaseAfterDrain();authority.dispose();}
 const inventory=inspectCompoundSourceInventory([f.storeRoot,oldRoot]);
 expect(()=>openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory})).toThrow('compound_domain_legacy_reconciliation_required');
 expect(existsSync(join(f.profileRoot,'compound-domains'))).toBe(false);
});

it('durably retains the complete supplied root census and returns an immutable copy',async()=>{
 const f=await fixture(),domain=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const binding=domain.getBinding();expect(binding.sourceRoots).toEqual([f.storeRoot]);expect(Object.isFrozen(binding.sourceRoots)).toBe(true);
 const reopened=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease});
 expect(reopened.getBinding().sourceRoots).toEqual(binding.sourceRoots);expect(reopened.getBinding().sourceInventoryDigest).toBe(f.inventory.digest);
});

it('linearizes retiring under the same root lease and rejects every old active guard',async()=>{
 const f=await fixture(),first=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease,inventory:f.inventory});
 const second=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease});
 expect(()=>first.beginRetirement({} as never)).toThrow();first.assertForEffect(f.lease);
 first.beginRetirement(f.lease);expect(first.getBinding().state).toBe('retiring');
 expect(()=>first.assertForEffect(f.lease)).toThrow();expect(()=>second.assertForEffect(f.lease)).toThrow();
 const restored=openCompoundExecutionDomain({owner:f.owner,storeRoot:f.storeRoot,lease:f.lease});
 expect(restored.getBinding().state).toBe('retiring');expect(()=>restored.assertCurrent()).toThrow();
 first.close(f.lease);
});
