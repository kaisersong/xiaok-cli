import type {LoopStore} from './loop-store.js';
import type {AssistantActionSource} from './assistant-action-store.js';
import type {AssistantActionDecisionResultDto} from '../shared/assistant-action-contract.js';
type RequestSource='user'|'agent'|'scheduler';
export class AssistantActionService {
 private readonly now:()=>number;
 constructor(private readonly options:{store:LoopStore;profileId:'default-personal-assistant';readSource:(requestSource:'user'|'scheduler')=>Promise<AssistantActionSource|undefined>;canStart?:()=>Promise<boolean>;now?:()=>number}){this.now=options.now??Date.now;}
 async list(input:{requestSource:RequestSource}){
  if(!input||(input.requestSource!=='user'&&input.requestSource!=='scheduler'))throw Error('assistant_action_source_denied');
  const source=await this.options.readSource(input.requestSource);
  if(!source)return {hasV2Source:false,proposals:[]};
  this.assertSource(source);
  const proposals=this.options.store.projectAssistantActions(source,this.now());
  const available=await this.options.canStart?.()??false;
  this.assertSource(source);
  return {hasV2Source:true,proposals:proposals.map(proposal=>({...proposal,startAvailability:available&&proposal.decision==='open'?'available' as const:'unavailable' as const}))};
 }
 async dismiss(input:{proposalId:string;expectedRevision:number;requestSource:RequestSource}):Promise<AssistantActionDecisionResultDto>{
  return this.decide({...input,decision:'dismissed'});
 }
 async snooze(input:{proposalId:string;expectedRevision:number;snoozeUntil:number;requestSource:RequestSource}):Promise<AssistantActionDecisionResultDto>{
  return this.decide({...input,decision:'snoozed'});
 }
 private async decide(input:{proposalId:string;expectedRevision:number;decision:'dismissed'|'snoozed';snoozeUntil?:number;requestSource:RequestSource}):Promise<AssistantActionDecisionResultDto>{
  if(input.requestSource!=='user')throw Error('assistant_action_user_only');
  if(typeof input.proposalId!=='string'||!/^assistant-action-[a-f0-9]{64}$/.test(input.proposalId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw Error('assistant_action_input');
  const now=this.now();
  if(input.decision==='snoozed'&&(!Number.isFinite(input.snoozeUntil)||(input.snoozeUntil??0)<=now||(input.snoozeUntil??0)>now+14*86400_000))throw Error('assistant_action_snooze_invalid');
  const source=await this.options.readSource('user');this.assertSource(source);
  return this.options.store.decideAssistantAction(source,{proposalId:input.proposalId,expectedRevision:input.expectedRevision,decision:input.decision,snoozeUntil:input.snoozeUntil,now});
 }
 private assertSource(source:AssistantActionSource|undefined):asserts source is AssistantActionSource{
  if(!source||source.profileId!==this.options.profileId||source.isCurrent()!==true)throw Error('assistant_action_source_unavailable');
 }
}
