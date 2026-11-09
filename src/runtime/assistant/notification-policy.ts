import {z} from 'zod';
export const assistantRevisionSchema=z.object({workItemIdentity:z.string().regex(/^[a-f0-9]{64}$/),notifiableRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const assistantDigestEnvelopeSchema=z.object({profileId:z.literal('default-personal-assistant'),deliveryId:z.string().uuid(),policyRevision:z.number().int().positive(),revisions:z.array(assistantRevisionSchema).min(1).max(3)}).strict();
export type AssistantDigestEnvelope=z.infer<typeof assistantDigestEnvelopeSchema>;
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const assistantPeriodicPolicySchema=z.object({profileId:z.literal('default-personal-assistant'),revision:z.number().int().nonnegative(),enabled:z.boolean(),notificationsEnabled:z.boolean(),intervalMinutes:z.number().int().min(30).max(1440),timeZone:z.string().min(1).max(100),quietHours:z.object({start:time,end:time}).strict(),qualityDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable(),analysisContract:z.string().min(1).max(256).nullable()}).strict();
export const assistantPeriodicConfigurationSchema=assistantPeriodicPolicySchema.pick({enabled:true,notificationsEnabled:true,intervalMinutes:true,quietHours:true}).partial({quietHours:true}).extend({expectedRevision:z.number().int().nonnegative(),requestSource:z.literal('user')}).strict();
export type AssistantPeriodicPolicy=z.infer<typeof assistantPeriodicPolicySchema>;
export type AssistantNotificationSuppression='quiet_hours'|'platform_unavailable'|'disabled'|'budget_exhausted'|'stale_policy';
export interface AssistantDigestFacts {policy:AssistantPeriodicPolicy;envelope:AssistantDigestEnvelope;profileActive:boolean;sourceCurrent:boolean;qualificationCurrent:boolean;budgetAdmitted:boolean}
/** Facts are re-read by the fixed owner; no client can supply canNotify. */
export function assistantNotificationSuppression(input:{facts:AssistantDigestFacts;envelope:AssistantDigestEnvelope;now:number;platformAvailable:boolean}):AssistantNotificationSuppression|undefined{
 const {facts,envelope,now}=input,p=facts.policy;
 if(!p.enabled||!p.notificationsEnabled||!facts.profileActive)return 'disabled';
 if(p.revision!==envelope.policyRevision||!p.qualityDigest||!p.analysisContract||!facts.sourceCurrent||!facts.qualificationCurrent||JSON.stringify(facts.envelope)!==JSON.stringify(envelope))return 'stale_policy';
 if(!facts.budgetAdmitted)return 'budget_exhausted';
 if(!input.platformAvailable)return 'platform_unavailable';
 try{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const minute=Number(parts.find(part=>part.type==='hour')?.value)*60+Number(parts.find(part=>part.type==='minute')?.value);
  const read=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));const start=read(p.quietHours.start),end=read(p.quietHours.end);
  if(!Number.isFinite(minute))return 'stale_policy';
  if(start===end||(start<end?minute>=start&&minute<end:minute>=start||minute<end))return 'quiet_hours';
 }catch{return 'stale_policy';}
}
