import { captureApplicationData } from '../verification/application-value-data.js';
import { capturedArrayIterator } from '../verification/application-iteration-intrinsics.js';
import { ownDataArrayIsArray, ownDataArrayPrototypeIncludes, ownDataBufferByteLength, ownDataObjectKeys, ownDataStringPrototypeTrim } from '../verification/application-native-intrinsics.js';

export interface AssistantActionDetails {
  kind: 'prepare' | 'follow_up' | 'review';
  reason: string;
  nextStep: string;
  instruction: string;
}
export interface AssistantActionRecommendation {
  title: string;
  reasonCode: string;
  evidenceRefs: Array<{kind:string;id:string}>;
  action: AssistantActionDetails;
}
/** Structure only. This is neither source freshness proof nor launch authority. */
export function parseAssistantActionRecommendation(raw: unknown): AssistantActionRecommendation {
  const value=captureApplicationData(raw,{maximumBytes:16*1024,maximumNodes:1024,invalid:'assistant_action_shape',limit:'assistant_action_size'});
  exact(value,['title','reasonCode','evidenceRefs','action']);
  bounded(value.title,160); bounded(value.reasonCode,600);
  exact(value.action,['kind','reason','nextStep','instruction']);
  if(!ownDataArrayPrototypeIncludes(['prepare','follow_up','review'],value.action.kind))throw Error('assistant_action_kind');
  bounded(value.action.reason,600); bounded(value.action.nextStep,400); bounded(value.action.instruction,4000);
  if(!ownDataArrayIsArray(value.evidenceRefs)||!value.evidenceRefs.length||value.evidenceRefs.length>20)throw Error('assistant_action_evidence');
  for(const reference of capturedArrayIterator(value.evidenceRefs)){
    exact(reference,['kind','id']); bounded(reference.kind,80);bounded(reference.id,512);
  }
  return value as unknown as AssistantActionRecommendation;
}
function exact(value:unknown,fields:readonly string[]):asserts value is Record<string,any>{
  if(!value||typeof value!=='object'||ownDataArrayIsArray(value))throw Error('assistant_action_shape');
  const keys=ownDataObjectKeys(value);
  if(keys.length!==fields.length)throw Error('assistant_action_shape');
  for(const key of capturedArrayIterator(keys))if(!ownDataArrayPrototypeIncludes(fields,key))throw Error('assistant_action_shape');
}
function bounded(value:unknown,limit:number):asserts value is string{
  if(typeof value!=='string'||!ownDataStringPrototypeTrim(value)||value.length>limit||ownDataBufferByteLength(value)>limit*4)throw Error('assistant_action_text');
}
