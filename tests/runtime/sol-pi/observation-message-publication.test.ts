import { expect, it } from 'vitest';
import { prepareObservationMessagePublication } from '../../../src/runtime/sol-pi/observation-message-publication.js';
it('rejects forged source, recipient and approval without invoking any publication callback', async () => {
  await expect(prepareObservationMessagePublication({ sourceOwner: {} as never, recipientOwner: {} as never, approval: {}, operationId: 'operation-1', text: 'protected', assertCurrent() {} })).rejects.toThrow();
});

import { afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { createDelegatedObservationSessionOwner } from '../../../src/runtime/sol-pi/delegated-session-owner.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
const cleanup: (()=>void)[]=[];
afterEach(()=>{try{cleanup.splice(0).reverse().forEach(fn=>fn());}finally{vi.useRealTimers();}});
async function fixture(captureSource=true){
 const root=mkdtempSync(join(tmpdir(),'observation-message-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 let now=Date.now();
 const service=createObservationService({profileRoot:join(root,'profile'),profileId:'test',now:()=>now,redactor:{version:'test',redact:text=>text}});cleanup.push(()=>service.dispose());
 const sourceSession=new AgentSessionState(),targetSession=new AgentSessionState();
 sourceSession.restoreSnapshot({...sourceSession.exportSnapshot(),sessionId:'source'});targetSession.restoreSnapshot({...targetSession.exportSnapshot(),sessionId:'target'});
 const destination={provider:'test',model:'test',url:'https://example.test/chat/completions'};
 const claims={sessionId:'source',ownerAgentId:'root',scopeId:'root',permissionGeneration:1,surface:'ordinary-owner' as const};
 const user=service.bindCaller({...claims,requestSource:'user'}),caller=service.bindCaller({...claims,requestSource:'agent'});
 service.setArchivePolicy({requestSource:'user',caller:user,policy:{version:1,id:'p',revision:1,scopeId:'root',sourceAdapterId:'native.bash.v1',sourceDescriptors:[JSON.stringify({toolName:'bash',command:'test',workdir:root})],localPersistence:true,allowUnclassifiedText:true,allowIncomplete:false,expiresAt:Date.now()+60000,destinations:[destination]}});
 const store=new FileSessionStore(join(root,'sessions')),capacityProfile=testOnlyCapacity(destination.url,destination.model);
 const sourceOwner=createObservationSessionOwner({service,caller,session:sourceSession,destination,capacityProfile,persist:snapshot=>store.save(snapshot)});cleanup.push(()=>sourceOwner.dispose());
 const approval=service.approveDelegation({requestSource:'user',caller:user,destination,maxDepth:2,maxChildren:2,expiresAt:Date.now()+30000});
 const recipient=service.bindCaller({...claims,sessionId:'target',ownerAgentId:'target',scopeId:'target',requestSource:'agent'});
 const capability=service.issueDelegationWithApproval({requestSource:'agent',caller,approval,recipient,observationIds:[],destination,expiresAt:Date.now()+20000});
 const registry=new ToolRegistry({autoMode:true},[]);cleanup.push(()=>registry.dispose());
 const recipientOwner=await createDelegatedObservationSessionOwner({parentOwner:sourceOwner,service,recipient,capability,session:targetSession,registry,destination,capacityProfile,persist:snapshot=>store.save(snapshot)});cleanup.push(()=>recipientOwner.dispose());
 if(captureSource){const capture=sourceOwner.collectorFor('captured-after-fork').begin({toolName:'bash',source:{command:'test',workdir:root}});capture.append('secret evidence');capture.finalize({executionState:'terminal',outcome:'success'});await sourceOwner.projectToolResult('captured-after-fork','secret evidence');}
 return {service,user,sourceOwner,recipientOwner,sourceSession,targetSession,approval,store,advanceClock:(ms:number)=>{now+=ms;}};
}
it('durably unions the real source closure before exact synchronous single-use journal admission',async()=>{
 const f=await fixture(),assertCurrent=vi.fn();
 const publication=await prepareObservationMessagePublication({...f,operationId:'operation-1',text:'derived message',assertCurrent});
 expect((await f.store.load('target'))?.protectedObservationClosure).toEqual(f.sourceSession.getProtectedObservationClosure());
 expect(()=>f.recipientOwner.prepareProviderDisclosure()).toThrow();
 const write=vi.fn((text:string)=>({id:'journal-1',text}));
 expect(publication.commit('operation-1','derived message',write)).toEqual({id:'journal-1',text:'derived message'});
 expect(()=>publication.commit('operation-1','derived message',write)).toThrow();expect(write).toHaveBeenCalledOnce();
});
it.each(['source-history','target-history','actor','revoke','async','wrong-text','wrong-operation'] as const)('refuses %s changes before any journal write',async change=>{
 const f=await fixture();let current=true;
 const publication=await prepareObservationMessagePublication({...f,operationId:'operation-1',text:'derived message',assertCurrent(){if(!current)throw Error('actor changed');}});
 if(change==='source-history')f.sourceSession.appendUserText('new history');
 if(change==='target-history')f.targetSession.appendUserText('new history');
 if(change==='actor')current=false;
 if(change==='revoke')f.service.revokeDelegationApproval({requestSource:'user',caller:f.user,approval:f.approval});
 const write=vi.fn();const asyncWrite=async()=>{write();return 'bad';};
 expect(()=>publication.commit(change==='wrong-operation'?'operation-2':'operation-1',change==='wrong-text'?'different':'derived message',change==='async'?asyncWrite:write)).toThrow();
 expect(write).not.toHaveBeenCalled();expect(()=>publication.commit('operation-1','derived message',write)).toThrow();
});

it.each(['forged','revoked','expired'] as const)('empty source still validates %s approval before issuing a message ticket',async mode=>{
 const f=await fixture(false);
 if(mode==='revoked')f.service.revokeDelegationApproval({requestSource:'user',caller:f.user,approval:f.approval});
 if(mode==='expired')f.advanceClock(60000);
 await expect(prepareObservationMessagePublication({...f,approval:mode==='forged'?{}:f.approval,operationId:'empty:1',text:'derived unknown text',assertCurrent(){}})).rejects.toThrow();
});
it('an empty-source ticket rechecks expiry synchronously at commit even before its timer runs',async()=>{
 const f=await fixture(false);const ticket=await prepareObservationMessagePublication({...f,operationId:'empty:2',text:'empty source message',assertCurrent(){}});
 f.advanceClock(60000);const write=vi.fn();
 expect(()=>ticket.commit('empty:2','empty source message',write)).toThrow();expect(write).not.toHaveBeenCalled();
});
it('an authorized empty-source message can commit once without inventing an observation reference',async()=>{
 const f=await fixture(false);const ticket=await prepareObservationMessagePublication({...f,operationId:'empty:3',text:'empty source message',assertCurrent(){}});const write=vi.fn(text=>text);
 expect(ticket.commit('empty:3','empty source message',write)).toBe('empty source message');expect(f.targetSession.getProtectedObservationClosure()).toBeUndefined();
});

it('host service can verify the actual publication issuer and participants without accepting a structural callback copy',async()=>{
 const f=await fixture(false);const publication=await prepareObservationMessagePublication({...f,operationId:'prepared-spawn:1',text:'prepared child task',assertCurrent(){}});
 const {getObservationMessagePublicationBinding}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
 expect(()=>getObservationMessagePublicationBinding({...publication})).toThrow();
 const binding=getObservationMessagePublicationBinding(publication);
 expect(binding.sourceOwner).toBe(f.sourceOwner);expect(binding.recipientOwner).toBe(f.recipientOwner);expect(binding.operationId).toBe('prepared-spawn:1');expect(binding.text).toBe('prepared child task');
 const write=vi.fn(text=>text);expect(binding.commit('prepared-spawn:1','prepared child task',write)).toBe('prepared child task');
 expect(()=>publication.commit('prepared-spawn:1','prepared child task',write)).toThrow();expect(write).toHaveBeenCalledOnce();
});

it('retains committed source authority until the final aggregate visibility boundary and refuses a structural copy',async()=>{
 const f=await fixture();
 const {withPublishedObservationMessages}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
 const ticket=await prepareObservationMessagePublication({...f,operationId:'aggregate:1',text:'derived aggregate',assertCurrent(){}});
 expect(()=>withPublishedObservationMessages([ticket],()=>true)).toThrow();
 ticket.commit('aggregate:1','derived aggregate',()=>{});
 expect(withPublishedObservationMessages([ticket],()=>true)).toBe(true);
 expect(()=>withPublishedObservationMessages([{...ticket}],()=>true)).toThrow();
 f.service.revokeDelegationApproval({requestSource:'user',caller:f.user,approval:f.approval});
 const expose=vi.fn();expect(()=>withPublishedObservationMessages([ticket],expose)).toThrow();expect(expose).not.toHaveBeenCalled();ticket.dispose();
});
it('checks the complete retained vector after a later participant reentrantly revokes authority',async()=>{
 const f=await fixture(false);let final=false;
 const {withPublishedObservationMessages}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
 const a=await prepareObservationMessagePublication({...f,operationId:'aggregate:a',text:'a',assertCurrent(){}});a.commit('aggregate:a','a',()=>{});
 const b=await prepareObservationMessagePublication({...f,operationId:'aggregate:b',text:'b',assertCurrent(){if(final)f.service.revokeDelegationApproval({requestSource:'user',caller:f.user,approval:f.approval});}});b.commit('aggregate:b','b',()=>{});
 final=true;const expose=vi.fn();expect(()=>withPublishedObservationMessages([a,b],expose)).toThrow();expect(expose).not.toHaveBeenCalled();a.dispose();b.dispose();
});


it.each([false,true])('reads previously returned source material after creator execution ends (archived=%s)',async archived=>{
 const f=await fixture(archived);
 if(archived){const forward=await prepareObservationMessagePublication({...f,operationId:'initial-forward',text:'parent context',assertCurrent(){}});forward.commit('initial-forward','parent context',()=>{});forward.dispose();}
 const returned=await prepareObservationMessagePublication({sourceOwner:f.recipientOwner,recipientOwner:f.sourceOwner,approval:f.approval,operationId:'actual-return',text:'returned body',assertCurrent(){}});
 returned.commit('actual-return','returned body',()=>{});returned.dispose();
 const {getObservationClosedReadAnchor}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
 const {withPublishedObservationMessages}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
 const anchor=getObservationClosedReadAnchor(f.recipientOwner);
 const reads=[{anchor,recipientOwner:f.sourceOwner}];
 expect(()=>withPublishedObservationMessages([],()=>true,reads)).toThrow();
 f.recipientOwner.dispose();
 expect(withPublishedObservationMessages([],()=> 'returned body',reads)).toBe('returned body');
 expect(()=>f.recipientOwner.assertSession(f.targetSession)).toThrow();
 expect(()=>withPublishedObservationMessages([],()=>true,[{anchor:{...anchor},recipientOwner:f.sourceOwner}])).toThrow();
 f.service.revokeDelegationApproval({requestSource:'user',caller:f.user,approval:f.approval});
 const expose=vi.fn();expect(()=>withPublishedObservationMessages([],expose,reads)).toThrow();expect(expose).not.toHaveBeenCalled();
});


it.each(['restore','expired','wrong-recipient','incomplete-publication','policy-revoked','source-revised'] as const)('closed source read refuses %s without reopening source execution',async mode=>{
 const f=await fixture(true);
 const forward=await prepareObservationMessagePublication({...f,operationId:'closed-forward',text:'parent context',assertCurrent(){}});forward.commit('closed-forward','parent context',()=>{});forward.dispose();
 const returned=await prepareObservationMessagePublication({sourceOwner:f.recipientOwner,recipientOwner:f.sourceOwner,approval:f.approval,operationId:'closed-return',text:'result',assertCurrent(){}});returned.commit('closed-return','result',()=>{});returned.dispose();
 const {getObservationClosedReadAnchor}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
 const {withPublishedObservationMessages}=await import('../../../src/runtime/sol-pi/observation-message-publication.js');
 const anchor=getObservationClosedReadAnchor(f.recipientOwner);
 if(mode==='incomplete-publication')f.targetSession.restoreSnapshot({...f.targetSession.exportSnapshot(),sessionId:'changed-source'});
 f.recipientOwner.dispose();
 if(mode==='restore')f.targetSession.restoreSnapshot(f.targetSession.exportSnapshot());
 if(mode==='expired')f.advanceClock(60000);
 if(mode==='policy-revoked')f.service.revokePolicy({requestSource:'user',caller:f.user,policyId:'p'});
 if(mode==='source-revised')f.service.reviseTerminal({requestSource:'user',caller:f.user,id:f.sourceSession.getProtectedObservationClosure()!.observations[0].observationId,outcome:'cancelled'});
 const recipientOwner=mode==='wrong-recipient'?(await fixture(false)).sourceOwner:f.sourceOwner;
 const visible=vi.fn();expect(()=>withPublishedObservationMessages([],visible,[{anchor,recipientOwner}])).toThrow();expect(visible).not.toHaveBeenCalled();
});

it('publishes an authorized next message closure while recipient transport remains actually paused',async()=>{
 const f=await fixture();
 const {getObservationSessionOwnerHostBinding}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
 const host=getObservationSessionOwnerHostBinding(f.recipientOwner);
 await host.pauseTransport();host.assertTransportPaused();
 const publication=await prepareObservationMessagePublication({...f,operationId:'paused-followup',text:'next literal message',assertCurrent(){}});
 expect((await f.store.load('target'))?.protectedObservationClosure).toEqual(f.sourceSession.getProtectedObservationClosure());
 expect(publication.commit('paused-followup','next literal message',text=>text)).toBe('next literal message');
 host.assertTransportPaused();
 expect(()=>f.recipientOwner.prepareProviderDisclosure()).toThrow();
 publication.dispose();
});
