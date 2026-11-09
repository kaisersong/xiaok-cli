import {types} from 'node:util';
const descriptor=Object.getOwnPropertyDescriptor,isProxy=types.isProxy,own=Object.hasOwn;
function data(raw:unknown,key:string):unknown{
 if(raw===null||(typeof raw!=='object'&&typeof raw!=='function')||isProxy(raw))return undefined;
 const row=descriptor(raw,key);return row&&own(row,'value')?row.value:undefined;
}
/** Diagnostics and conservative charging only; never authorization. Native
 * error data is observed without invoking a getter, Proxy or user coercion. */
export function readAssistantProviderStatus(raw:unknown):number|undefined{
 const value=data(raw,'status');return typeof value==='number'&&Number.isInteger(value)&&value>=400&&value<=599?value:undefined;
}
export function readAssistantProviderBreachUsage(raw:unknown):{inputTokens:number;outputTokens:number}|undefined{
 if(data(raw,'code')!=='ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH')return undefined;
 const usage=data(raw,'usage'),inputTokens=data(usage,'inputTokens'),outputTokens=data(usage,'outputTokens');
 if(typeof inputTokens!=='number'||!Number.isSafeInteger(inputTokens)||inputTokens<0||typeof outputTokens!=='number'||!Number.isSafeInteger(outputTokens)||outputTokens<0)return undefined;
 return {inputTokens,outputTokens};
}
