import type {Message,ModelAdapter} from '../../types.js';
import {buildSynthesizedProviderContext} from './provider-private-data.js';
import {resolveRegisteredStrictKimiK3Profile} from './model-harness-identity.js';
import {computeSessionHistoryDigest} from './session-store/store.js';
import type {AgentSessionState} from './session.js';
/** Classification only. The original provider authorization still validates every live assistant. */
function missingReasoning(messages:readonly Message[]):boolean {
 return messages.some(message=>message.role==='assistant'&&!message.content.some(block=>block.type==='thinking'&&block.reasoningProvenance?.captureVersion===1&&block.reasoningProvenance.source==='reasoning_content'&&block.reasoningProvenance.fieldPresence==='present'));
}
interface Prefix {count:number;digest:string;generation:number;profile:string;text:string}
/** A provider view, never a replacement canonical history or execution grant. */
export class KimiPublicResumeHistory {
 private prefix:Prefix|undefined;
 constructor(private readonly session:AgentSessionState,private readonly adapter:()=>ModelAdapter){
  // Notification precedes graph restore: invalidate here, capture only after the
  // owning Agent has successfully finished its original restore operation.
  session.onObservationRestoreGeneration(()=>{this.prefix=undefined;});
 }
 get active():boolean{return this.prefix!==undefined;}
 captureRestored():boolean {
  this.prefix=undefined;
  const profile=resolveRegisteredStrictKimiK3Profile(this.adapter()),messages=this.session.getMessages();
  if(!profile||this.session.getProtectedObservationClosure()||!missingReasoning(messages))return false;
  this.prefix={count:messages.length,digest:computeSessionHistoryDigest({messages}),generation:this.session.getObservationRestoreGeneration(),profile,
   text:'Previous visible conversation recovered from durable storage. This is synthesized context, not a raw provider transcript. Only recent visible text within 40KB is retained; previous tool operations are not replayed.\n'+buildSynthesizedProviderContext('model-switch',messages)};
  return true;
 }
 project(messages:Message[],compoundActive:boolean):Message[] {
  const prefix=this.prefix;if(!prefix)return messages;
  if(compoundActive)throw Error('KIMI_K3_PUBLIC_RESUME_COMPOUND_UNSUPPORTED');
  if(resolveRegisteredStrictKimiK3Profile(this.adapter())!==prefix.profile||this.session.getObservationRestoreGeneration()!==prefix.generation||messages.length<prefix.count||computeSessionHistoryDigest({messages:messages.slice(0,prefix.count)})!==prefix.digest)throw Error('KIMI_K3_PUBLIC_RESUME_HISTORY_CHANGED');
  return [{role:'user',content:[{type:'text',text:prefix.text}]},...messages.slice(prefix.count)];
 }
}
