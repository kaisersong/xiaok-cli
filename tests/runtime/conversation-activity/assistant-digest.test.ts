import {it,expect,vi} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import type {AssistantDigestFacts} from '../../../src/runtime/assistant/notification-policy.js';
const envelope={profileId:'default-personal-assistant' as const,deliveryId:'c71f96bc-9716-4998-a572-3f98fa797728',policyRevision:1,revisions:[{workItemIdentity:'a'.repeat(64),notifiableRevision:'b'.repeat(64)}]};
function fixture(){const root=mkdtempSync(join(tmpdir(),'assistant-digest-owner-')),store=new ConversationActivityStore(join(root,'activity.sqlite'));
 let now=Date.parse('2026-11-02T01:00:00Z'),platform=true;
 let facts:AssistantDigestFacts={policy:{profileId:envelope.profileId,revision:1,enabled:true,notificationsEnabled:true,intervalMinutes:240,timeZone:'Asia/Shanghai',quietHours:{start:'22:00',end:'08:00'},qualityDigest:'a'.repeat(64),analysisContract:'qualified-test-v1'},envelope,profileActive:true,sourceCurrent:true,qualificationCurrent:true,budgetAdmitted:true};
 const notify=vi.fn(async()=> 'shown' as const),service=new ConversationActivityService({store,profileId:'desktop-profile',actorId:'desktop-user',getThread:()=>null,canObserveWork:()=>false,assistantDigest:{readFacts:()=>facts,now:()=>now,platformAvailable:()=>platform,notify}});
 return {store,service,notify,setNow:(value:number)=>{now=value;},disable:()=>{facts={...facts,policy:{...facts.policy,enabled:false}};},revoke:()=>{facts={...facts,qualificationCurrent:false};},unsupported:()=>{platform=false;},async close(){await service.close();store.close();rmSync(root,{recursive:true,force:true});}};
}
it('claims one generic digest through the existing owner; duplicate requests never ring twice',async()=>{const f=fixture();try{
 const [a,b]=await Promise.all([f.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'}),f.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})]);
 expect(a.deliveryId).toBe(b.deliveryId);expect(f.notify).toHaveBeenCalledTimes(1);expect(f.store.getAssistantDigestReceipt(envelope.deliveryId)?.status).toBe('shown');
}finally{await f.close();}});
it('checks cross-midnight quiet hours and distinguishes platform suppression',async()=>{const f=fixture();try{
 f.setNow(Date.parse('2026-11-02T15:00:00Z'));
 expect(await f.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})).toMatchObject({status:'suppressed',suppressionReason:'quiet_hours'});expect(f.notify).not.toHaveBeenCalled();
}finally{await f.close();}
 const other=fixture();try{other.unsupported();expect(await other.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})).toMatchObject({status:'suppressed',suppressionReason:'platform_unavailable'});expect(other.notify).not.toHaveBeenCalled();}finally{await other.close();}});
it('rechecks current policy after the durable claim and never replays unknown OS outcomes',async()=>{const f=fixture();try{
 const claim=f.store.claimAssistantDigest.bind(f.store);vi.spyOn(f.store,'claimAssistantDigest').mockImplementation(input=>{const result=claim(input);f.disable();return result;});
 expect(await f.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})).toMatchObject({status:'suppressed',suppressionReason:'disabled'});expect(f.notify).not.toHaveBeenCalled();
}finally{await f.close();}
 const other=fixture();try{other.notify.mockRejectedValueOnce(Error('unconfirmed OS outcome'));
 expect((await other.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})).status).toBe('unknown');await other.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'});expect(other.notify).toHaveBeenCalledTimes(1);
}finally{await other.close();}});
it('rejects agent and user submissions before notification owner side effects',async()=>{const f=fixture();try{
 for(const requestSource of ['user','agent'] as const)await expect(f.service.enqueueAssistantDigest(envelope,{requestSource})).rejects.toThrow('denied');expect(f.notify).not.toHaveBeenCalled();
}finally{await f.close();}});

it('revoked live quality blocks the OS gate even while the stored enabled policy is unchanged',async()=>{const f=fixture();try{
 const claim=f.store.claimAssistantDigest.bind(f.store);vi.spyOn(f.store,'claimAssistantDigest').mockImplementation(input=>{const result=claim(input);f.revoke();return result;});
 expect(await f.service.enqueueAssistantDigest(envelope,{requestSource:'scheduler'})).toMatchObject({status:'suppressed',suppressionReason:'stale_policy'});expect(f.notify).not.toHaveBeenCalled();
}finally{await f.close();}});
