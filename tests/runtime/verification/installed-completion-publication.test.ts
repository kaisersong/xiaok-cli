import {it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({route:{kind:'ordinary'} as any,opens:0,closes:0,calls:[] as string[],changeAfterCall:false}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>fixture.route}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient(){fixture.opens++;return{dispose(){fixture.closes++;},publicationTransport:{async call(method:string){fixture.calls.push(method);const owner=fixture.route.owner;if(fixture.changeAfterCall)fixture.route={kind:'unavailable'};if(method==='publication.recoverRequest')return{status:'not_prepared'};if(method==='publication.lookupRequest')return{state:'not_prepared'};if(method==='publication.prepare'||method==='publication.prepareRequest')return{challengeId:'challenge',owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:2}};return{owner,operationId:'operation',fullTupleHash:'a'.repeat(64),status:'committed',businessRevision:2,currentVerification:'valid'};}}};}}));
import {createInstalledCompletionPublisher} from '../../../src/runtime/verification/installed-completion-publication.js';
const owner={ownerKind:'task' as const,ownerId:'task'},registered={kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}};
it('requires fixed protected routing and never opens a client for ordinary, pending or unavailable owners',()=>{
 for(const kind of ['ordinary','pending','unavailable']){fixture.route={kind};const before=fixture.opens;expect(()=>createInstalledCompletionPublisher(owner,'agent')).toThrow('owner_unavailable');expect(fixture.opens).toBe(before);}
});
it('binds newly enrolled protected owners and rejects route changes both before and after RPC',async()=>{
 fixture.calls=[];fixture.changeAfterCall=false;fixture.route=registered;const publisher=createInstalledCompletionPublisher(owner,'agent');
 try{const ticket=await publisher.prepare();fixture.route={...registered,owner:{...registered.owner,profileId:'other'}};await expect(publisher.approve(ticket)).rejects.toThrow('owner_changed');expect(fixture.calls).toEqual(['publication.prepare']);fixture.route=registered;fixture.changeAfterCall=true;await expect(publisher.approve(ticket)).rejects.toThrow('owner_changed');expect(fixture.calls).toEqual(['publication.prepare','publication.approve']);}
 finally{fixture.changeAfterCall=false;publisher.dispose();}
 fixture.route=registered;await expect(publisher.prepare()).rejects.toThrow('owner_changed');
});
it('never turns persisted JSON into an approval ticket but permits bound read-only reconciliation',async()=>{
 fixture.calls=[];fixture.route=registered;const publisher=createInstalledCompletionPublisher(owner,'scheduler');
 try{const ticket=await publisher.prepare(),copy=JSON.parse(JSON.stringify(ticket));await expect(publisher.approve(copy)).rejects.toThrow('publication_client_challenge');expect((await publisher.reconcile(copy)).status).toBe('committed');expect(fixture.calls).toEqual(['publication.prepare','publication.reconcile']);}
 finally{publisher.dispose();}
});

it('fixed durable request methods preserve route checks and recovery never creates approval tickets',async()=>{
 fixture.calls=[];fixture.route=registered;fixture.changeAfterCall=false;const publisher=createInstalledCompletionPublisher(owner,'agent');
 try{const ticket=await publisher.prepareRequest('original-request');expect(ticket.challengeId).toBe('challenge');expect(await publisher.lookupRequest('original-request')).toEqual({state:'not_prepared'});expect(await publisher.recoverRequest('original-request')).toEqual({status:'not_prepared'});expect(fixture.calls).toEqual(['publication.prepareRequest','publication.lookupRequest','publication.recoverRequest']);fixture.changeAfterCall=true;await expect(publisher.recoverRequest('original-request')).rejects.toThrow('owner_changed');}
 finally{fixture.changeAfterCall=false;publisher.dispose();}
});
