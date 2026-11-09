import {z} from 'zod';
import type {KimWindow} from '../../src/ai/kim/contracts.js';
const timestamp=z.string().datetime({offset:true});
export const ASSISTANT_MESSAGE_RANGE=z.object({startAt:timestamp,endAt:timestamp}).strict().refine(v=>Date.parse(v.endAt)>Date.parse(v.startAt)&&Date.parse(v.endAt)-Date.parse(v.startAt)<=7*86400000).transform(v=>({startAt:new Date(v.startAt).toISOString(),endAt:new Date(v.endAt).toISOString()}));
export type AssistantMessageRange=z.output<typeof ASSISTANT_MESSAGE_RANGE>;
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=256&&!x.includes('\0');
interface SourceMessage {sender:string;text:string;id:string;sentAt:number;rawSentAt:string|number;timeAssumed:boolean}
export interface AssistantMessageSample {identity:string;observedRange:{startAt:string;endAt:string}|null;windows:Array<{groupId:string;direction:'self'|'other';rawSentAt:string|number;timeAssumed:boolean;window:KimWindow}>;coverage:{sampled:true;partial:true;scope:'recent_conversations_latest_messages';groupsRead:number;failedGroups:number;fetched:number;withinRange:number;unknownTime:number;oversize:number;invalid:number;duplicates:number;conflicts:number;timeInterpretation:{zone:string;assumed:boolean;count:number}}}
/** No host-TZ Date.parse for timezone-less provider strings. The user setting is an explicit assumption. */
function sourceTime(raw:unknown,zone:string):{time:number;assumed:boolean}|undefined {
 if(typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0&&Number.isFinite(new Date(raw).getTime()))return {time:raw,assumed:false};
 if(typeof raw!=='string')return;
 const explicit=timestamp.safeParse(raw);if(explicit.success){const time=Date.parse(raw);if(Number.isFinite(time)&&time>=0)return {time,assumed:false};return;}
 const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(raw);
 if(zone!=='Asia/Shanghai'||!m)return;
 const normalized=`${m[1]}T${m[2]}.${(m[3]??'').padEnd(3,'0')}`,time=Date.parse(`${normalized}+08:00`);
 if(!Number.isFinite(time)||time<0||new Date(time+8*3600000).toISOString().slice(0,23)!==normalized)return;
 return {time,assumed:true};
}
export async function readAssistantMessageWindows(deps:{actor(signal:AbortSignal):Promise<{openId:string;identity:string}>;data(args:string[],signal:AbortSignal):Promise<Record<string,unknown>>},raw:unknown,signal:AbortSignal,progress?:()=>void,naiveTimeZone=''):Promise<AssistantMessageSample>{
 const range=ASSISTANT_MESSAGE_RANGE.parse(raw);signal.throwIfAborted();const actor=await deps.actor(signal);signal.throwIfAborted();
 const groups=await deps.data(['im','group','recent','--limit','5','--page','1'],signal);if(!Array.isArray(groups.list))throw Error('assistant_source_failed');
 const coverage:AssistantMessageSample['coverage']={sampled:true,partial:true,scope:'recent_conversations_latest_messages',groupsRead:0,failedGroups:0,fetched:0,withinRange:0,unknownTime:0,oversize:0,invalid:0,duplicates:0,conflicts:0,timeInterpretation:{zone:naiveTimeZone,assumed:false,count:0}};
 const windows:AssistantMessageSample['windows']=[],seenGroups=new Set<string>(),selected:Record<string,unknown>[]=[];
 for(const rawGroup of groups.list.slice(0,5)){const g=object(rawGroup);if(!id(g.groupId)){coverage.invalid++;continue;}if(seenGroups.has(g.groupId)){coverage.duplicates++;continue;}seenGroups.add(g.groupId);selected.push(g);}
 let cursor=0;
 const worker=async()=>{while(cursor<selected.length){signal.throwIfAborted();const group=selected[cursor++],groupId=String(group.groupId),groupName=typeof group.groupName==='string'?group.groupName.slice(0,200):'Cloud message';
 let data:Record<string,unknown>;try{data=await deps.data(['im','message','list',`--group-id=${groupId}`,'--type','newest','--limit','20'],signal);if(!Array.isArray(data.list))throw Error('assistant_source_failed');}catch{signal.throwIfAborted();coverage.failedGroups++;progress?.();continue;}
 signal.throwIfAborted();coverage.groupsRead++;const rows:SourceMessage[]=[],unique=new Map<string,Record<string,unknown>>(),conflicts=new Set<string>();
 for(const rawMessage of (data.list as unknown[]).slice(0,20)){coverage.fetched++;const m=object(rawMessage);if(!id(m.msgId)){coverage.invalid++;continue;}const before=unique.get(m.msgId);if(before){const signature=(r:Record<string,unknown>)=>JSON.stringify([r.content,r.fromOpenId,r.sendTime]);if(signature(before)===signature(m))coverage.duplicates++;else conflicts.add(m.msgId);}else unique.set(m.msgId,m);}
 coverage.conflicts+=conflicts.size;
 for(const m of unique.values()){if(conflicts.has(String(m.msgId)))continue;if(!id(m.msgId)||!id(m.fromOpenId)||typeof m.content!=='string'||!m.content.length){coverage.invalid++;continue;}if(m.content.length>10000){coverage.oversize++;continue;}const parsed=sourceTime(m.sendTime,naiveTimeZone);if(!parsed){coverage.unknownTime++;continue;}if(parsed.assumed){coverage.timeInterpretation.assumed=true;coverage.timeInterpretation.count++;}rows.push({id:m.msgId,sender:m.fromOpenId,text:m.content,sentAt:parsed.time,rawSentAt:m.sendTime as string|number,timeAssumed:parsed.assumed});}
 for(const target of rows){if(target.sentAt<Date.parse(range.startAt)||target.sentAt>=Date.parse(range.endAt))continue;coverage.withinRange++;const context=rows.filter(m=>m.id!==target.id&&m.sentAt<target.sentAt&&m.sentAt>=target.sentAt-1800000).sort((a,b)=>a.sentAt-b.sentAt).slice(-10).map(({id,sender,text,sentAt})=>({id,sender,text,sentAt}));windows.push({groupId,direction:target.sender===actor.openId?'self':'other',rawSentAt:target.rawSentAt,timeAssumed:target.timeAssumed,window:{group:groupName,target:{id:target.id,sender:target.sender,text:target.text,sentAt:target.sentAt},context}});}
 progress?.();
 }};
 await Promise.all([worker(),worker()]);signal.throwIfAborted();if((await deps.actor(signal)).identity!==actor.identity)throw Error('assistant_account_changed');signal.throwIfAborted();
 windows.sort((a,b)=>b.window.target.sentAt!-a.window.target.sentAt!||a.groupId.localeCompare(b.groupId)||a.window.target.id!.localeCompare(b.window.target.id!));return {identity:actor.identity,windows,coverage,observedRange:windows.length?{startAt:new Date(windows[windows.length-1].window.target.sentAt!).toISOString(),endAt:new Date(windows[0].window.target.sentAt!).toISOString()}:null};
}
