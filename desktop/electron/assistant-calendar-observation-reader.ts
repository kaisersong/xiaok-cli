import {captureIpcData} from './ipc-data-snapshot.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {z} from 'zod';
const millisecond=z.number().refine(value=>Number.isSafeInteger(value)&&value>=1_000_000_000_000&&Number.isFinite(new Date(value).getTime()));
const windowSchema=z.object({from:millisecond,to:millisecond}).strict().refine(value=>value.to>value.from&&value.to-value.from<=8*86400000);
export interface AssistantCalendarObservation {
 records:Record<string,unknown>[];
 accountId:string;
 window:{from:number;to:number};
 /** Enumeration only: never occurrence, cancellation or all-day completeness. */
 completeness:'complete'|'partial'|'unknown';
}
/** Fixed bundled CLI transport, consumed by the existing Main client. Account
 * hashes describe the observed account; they grant no source/custody authority.
 * There is no binary/profile/endpoint or caller-selected command argument. */
export async function readAssistantCalendarObservation(
 ports:{identity(signal?:AbortSignal):Promise<string>;data(args:string[],signal?:AbortSignal):Promise<Record<string,unknown>>},
 raw:unknown,expectedIdentity:string,signal?:AbortSignal,
):Promise<AssistantCalendarObservation>{
 const invalid=()=>Error('assistant_calendar_observation_invalid');
 const parsed=windowSchema.safeParse(raw);
 if(!parsed.success||typeof expectedIdentity!=='string'||!/^[a-f0-9]{64}$/.test(expectedIdentity))throw invalid();
 const window=parsed.data;signal?.throwIfAborted();
 const accountId=await ports.identity(signal);
 if(accountId!==expectedIdentity)throw Error('assistant_account_changed');
 signal?.throwIfAborted();
 // Official CLI 0.1.8 accepts Unix milliseconds. to-1 preserves this
 // half-open local window without timezone parsing or fractional ISO seconds.
 const data=captureIpcData(await ports.data(['calendar','event','list','--start',String(window.from),'--end',String(window.to-1)],signal),'assistant_calendar_observation_invalid');
 signal?.throwIfAborted();
 if(!data||typeof data!=='object'||Array.isArray(data))throw invalid();
 if(!Array.isArray(data.list)||data.list.length>200||data.list.some(row=>!row||typeof row!=='object'||Array.isArray(row))
  ||data.count!==undefined&&(!Number.isSafeInteger(data.count)||(data.count as number)<data.list.length)
  ||data.total!==undefined&&(!Number.isSafeInteger(data.total)||(data.total as number)<data.list.length)
  ||data.more!==undefined&&typeof data.more!=='boolean'
  ||data.pageToken!==undefined&&typeof data.pageToken!=='string')throw invalid();
 let records:Record<string,unknown>[];
 try{if(Buffer.byteLength(canonicalVerificationJson(data.list))>1024*1024)throw invalid();records=data.list as Record<string,unknown>[];}
 catch{throw invalid();}
 signal?.throwIfAborted();
 if(await ports.identity(signal)!==accountId)throw Error('assistant_account_changed');
 signal?.throwIfAborted();
 const partial=records.length===200||data.more===true||!!data.pageToken
  ||typeof data.count==='number'&&data.count>records.length
  ||typeof data.total==='number'&&data.total>records.length;
 return {records,accountId,window,completeness:partial?'partial':data.more===false?'complete':'unknown'};
}
