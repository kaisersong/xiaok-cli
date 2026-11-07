import {parseDshModelJson} from './assessment-output.js';
const safe=Number.isSafeInteger,is=Object.is,freeze=Object.freeze,own=Object.hasOwn,isArray=Array.isArray,NativeBigInt=BigInt,NativeNumber=Number,NativeError=Error;
type R=Record<string,unknown>;
export type DshReportedUsage=Readonly<{kind:'reported';inputTokens:number;outputTokens:number;totalTokens:number;cachedInputTokens:number;uncachedInputTokens:number;reasoningTokens:number|null;chargedCostUpperBoundMicros:number;costBasis:'conservative_upper_bound'}>;
export interface DshUnverifiedProviderResponse {
 readonly kind:'unverified_provider_response';readonly responseId:string;
 readonly usage:DshReportedUsage|Readonly<{kind:'unknown'}>;
 readonly text:Readonly<{kind:'complete';content:string}>|Readonly<{kind:'unusable'}>;
}
const unknown=freeze({kind:'unknown' as const}),unusable=freeze({kind:'unusable' as const});
function record(value:unknown):R{if(!value||typeof value!=='object'||isArray(value))throw new NativeError('DSH_MODEL_RESPONSE_INVALID');return value as R;}
function count(value:unknown):number{if(typeof value!=='number'||!safe(value)||value<0||is(value,-0)||value>1e12)throw new NativeError('DSH_MODEL_USAGE_INVALID');return value;}
function usage(raw:unknown):DshUnverifiedProviderResponse['usage'] {
 try{const value=record(raw),input=count(value.prompt_tokens),output=count(value.completion_tokens),total=count(value.total_tokens),hit=count(value.prompt_cache_hit_tokens),miss=count(value.prompt_cache_miss_tokens);if(input<1||input+output!==total||hit+miss!==input)throw Error();
  if(value.prompt_tokens_details!==undefined){const details=record(value.prompt_tokens_details);if(own(details,'cached_tokens')&&count(details.cached_tokens)!==hit)throw Error();}
  let reasoning:number|null=null;if(value.completion_tokens_details!==undefined){const details=record(value.completion_tokens_details);if(own(details,'reasoning_tokens')){reasoning=count(details.reasoning_tokens);if(reasoning>output)throw Error();}}
  // Reviewed peak USD micro rates, per million tokens. This is an upper
  // bound, never an exact invoice, settlement receipt or pricing capability.
  const numerator=NativeBigInt(miss)*300000n+NativeBigInt(hit)*6000n+NativeBigInt(output)*1200000n,cost=(numerator+999999n)/1000000n;
  if(cost>NativeBigInt(Number.MAX_SAFE_INTEGER))throw Error();
  return freeze({kind:'reported',inputTokens:input,outputTokens:output,totalTokens:total,cachedInputTokens:hit,uncachedInputTokens:miss,reasoningTokens:reasoning,chargedCostUpperBoundMicros:NativeNumber(cost),costBasis:'conservative_upper_bound'});
 }catch{return unknown;}
}
/** Decode bytes obtained by the actual provider owner separately from its
 * SDK/budget fate. This DTO cannot authenticate a response or settle funds.
 * Truncated/unusable content does not erase reported billable usage. */
export function decodeDshChatCompletion(raw:unknown):DshUnverifiedProviderResponse {
 try{const value=record(parseDshModelJson(raw,2*1024*1024));if(value.object!=='chat.completion'||value.model!=='deepseek-flash'||typeof value.id!=='string'||!value.id||value.id.length>256)throw Error();
  const reported=usage(value.usage);let text:DshUnverifiedProviderResponse['text']=unusable;
  if(isArray(value.choices)&&value.choices.length===1){const choice=record(value.choices[0]),message=record(choice.message);if(choice.index===0&&choice.finish_reason==='stop'&&message.role==='assistant'&&typeof message.content==='string'&&message.content.length>0&&message.content.length<=32768&&message.function_call===undefined&&(message.tool_calls===undefined||isArray(message.tool_calls)&&message.tool_calls.length===0))text=freeze({kind:'complete',content:message.content});}
  return freeze({kind:'unverified_provider_response',responseId:value.id,usage:reported,text});
 }catch{throw new NativeError('DSH_MODEL_RESPONSE_INVALID');}
}
