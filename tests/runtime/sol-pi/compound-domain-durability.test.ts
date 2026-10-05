import {it,expect,vi} from 'vitest';
const fault=vi.hoisted(()=>({afterIndexRename:false,afterCleanRename:false,directory:false}));
vi.mock('node:fs',async original=>{
 const fs=await original<typeof import('node:fs')>();return{...fs,renameSync(from:import('node:fs').PathLike,to:import('node:fs').PathLike){fs.renameSync(from,to);if(fault.afterIndexRename&&String(to).endsWith('/compound-domains/index.json'))fault.directory=true;if(fault.afterCleanRename&&String(to).endsWith('/compound-domains/owner-state.json')&&JSON.parse(fs.readFileSync(to,'utf8')).cleanShutdown===true)fault.directory=true;},fsyncSync(fd:number){if(fault.directory&&fs.fstatSync(fd).isDirectory())throw Error('domain directory fsync failed');return fs.fsyncSync(fd);}};
});
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createObservationService} from '../../../src/runtime/sol-pi/observation-service.js';
import {createObservationSessionOwner} from '../../../src/runtime/sol-pi/observation-session-owner.js';
import {openCompoundExecutionDomain,COMPOUND_DOMAIN_RESERVED_BYTES} from '../../../src/runtime/sol-pi/compound-execution-domain.js';
import {inspectCompoundSourceInventory} from '../../../src/runtime/sol-pi/compound-source-inventory.js';
async function host(root:string){
 const storeRoot=join(root,'sessions');mkdirSync(storeRoot,{recursive:true});const store=new FileSessionStore(storeRoot);
 const service=createObservationService({profileRoot:join(root,'profile'),profileId:'p',reservedProfileBytes:COMPOUND_DOMAIN_RESERVED_BYTES,redactor:{version:'no-capture',redact(){throw Error('no capture');}}});
 const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'canonical',cwd:root});
 const caller=service.bindCaller({sessionId:'canonical',ownerAgentId:'host',scopeId:'scope',permissionGeneration:1,surface:'ordinary-owner',requestSource:'agent'});
 const owner=createObservationSessionOwner({service,caller,session,destination:{provider:'test',model:'test',url:'https://example.test'},persist:value=>store.save(value)});
 const authority=createSessionExecutionAuthority({root:storeRoot,sessionIdentity:'canonical',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const lease=await authority.acquire({invocationId:'open',kind:'recovery'});let closed=false;
 return{owner,lease,storeRoot,revoke(){const user=service.bindCaller({sessionId:'canonical',ownerAgentId:'host',scopeId:'scope',permissionGeneration:1,surface:'ordinary-owner',requestSource:'user'});service.revokeCaller({caller:user,requestSource:'user',target:caller});},inventory:inspectCompoundSourceInventory([storeRoot]),async dispose(){if(closed)return;closed=true;owner.dispose();await lease.releaseAfterDrain();authority.dispose();service.dispose();}};
}
it('does not publish a failed index after rename and fsync error through restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'domain-durability-'));let current=await host(root);
 try{
  fault.afterIndexRename=true;expect(()=>openCompoundExecutionDomain(current)).toThrow('domain directory fsync failed');
  fault.afterIndexRename=false;fault.directory=false;expect(()=>openCompoundExecutionDomain(current)).toThrow(/uncertain/);await current.dispose();current=await host(root);
  expect(()=>openCompoundExecutionDomain(current)).toThrow(/uncertain/);
 }finally{fault.afterIndexRename=false;fault.directory=false;await current.dispose();rmSync(root,{recursive:true,force:true});}
});

it('closes the original guard before a confirmed metadata-only clean restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'domain-clean-'));let current=await host(root);
 try{const domain=openCompoundExecutionDomain(current);const before=domain.getBinding();domain.close(current.lease);expect(()=>domain.assertCurrent()).toThrow(/uncertain/);
  await current.dispose();current=await host(root);const next=openCompoundExecutionDomain(current);expect(next.getBinding()).toEqual(before);next.close(current.lease);
 }finally{await current.dispose();rmSync(root,{recursive:true,force:true});}
});
it('a failed clean-marker flush does not invalidate already-confirmed prior metadata',async()=>{
 const root=mkdtempSync(join(tmpdir(),'domain-clean-error-'));let current=await host(root);
 try{const domain=openCompoundExecutionDomain(current);fault.afterCleanRename=true;expect(()=>domain.close(current.lease)).toThrow('domain directory fsync failed');expect(()=>domain.assertCurrent()).toThrow(/uncertain/);
  fault.afterCleanRename=false;fault.directory=false;await current.dispose();current=await host(root);const next=openCompoundExecutionDomain(current);next.assertCurrent();next.close(current.lease);
 }finally{fault.afterCleanRename=false;fault.directory=false;await current.dispose();rmSync(root,{recursive:true,force:true});}
});

it('permits only original metadata cleanup after real caller revocation and owner disposal without reviving the effect guard',async()=>{
 const root=mkdtempSync(join(tmpdir(),'domain-revoked-close-')),current=await host(root);
 try{const domain=openCompoundExecutionDomain(current);current.revoke();current.owner.dispose();expect(()=>domain.assertCurrent()).toThrow();expect(()=>domain.close(current.lease)).not.toThrow();expect(()=>domain.assertCurrent()).toThrow();}
 finally{await current.dispose();rmSync(root,{recursive:true,force:true});}
});
