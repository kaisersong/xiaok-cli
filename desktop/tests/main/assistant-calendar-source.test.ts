import {describe,it,expect} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantCalendarSource} from '../../electron/assistant-calendar-source.js';
const now=Date.parse('2026-11-01T00:00:00Z');
const item={id:'event-one',title:'A meeting',startDate:now+3600000,endDate:now+7200000,timeZone:'Asia/Shanghai'};
function fixture(){
 const store=new LoopStore(':memory:');let account='account-one',more:'unknown'|'complete'|'partial'='unknown';
 let hook=()=>{};
 const service=new AssistantCalendarSource({store,now:()=>now,connect:async()=>({binary:'/verified/yzj-cli',accountId:account}),read:async grant=>{hook();return {accountId:account,grantEpoch:grant.epoch,records:[item],completeness:more};}});
 return {service,store,hook:(fn:()=>void)=>{hook=fn;},account:(value:string)=>{account=value;},complete:()=>{more='complete';}};
}
describe('read-only calendar source ownership',()=>{
 it('defaults disabled and requires user consent for every settings mutation',async()=>{const f=fixture();try{
  expect(f.service.status().enabled).toBe(false);
  for(const requestSource of ['agent','scheduler'] as const){await expect(f.service.enable({requestSource})).rejects.toThrow('user_only');expect(()=>f.service.disable({requestSource})).toThrow('user_only');}
  expect((await f.service.collect({now,requestSource:'scheduler'})).status).toBe('disabled');
 }finally{f.store.close();}});
 it('stores bounded fields but keeps absent completeness and event semantics unknown',async()=>{const f=fixture();try{
  await f.service.enable({requestSource:'user'});const result=await f.service.collect({now,requestSource:'scheduler'});
  expect(result).toMatchObject({status:'partial',events:[{title:item.title,start:item.startDate,allDay:'unknown',cancelled:'unknown'}]});
  expect(f.service.status().lastCompleteWatermark).toBeNull();expect(result.events[0]).not.toHaveProperty('description');
 }finally{f.store.close();}});
 it('discards late reads after revoke and hides previous event bodies',async()=>{const f=fixture();try{
  await f.service.enable({requestSource:'user'});await f.service.collect({now,requestSource:'scheduler'});
  f.hook(()=>{f.service.disable({requestSource:'user'});});
  expect((await f.service.collect({now,requestSource:'scheduler'})).events).toEqual([]);expect(f.service.latest()).toMatchObject({status:'disabled',events:[]});
 }finally{f.store.close();}});
 it('account switch cannot commit previous-account facts or advance watermark',async()=>{const f=fixture();try{
  await f.service.enable({requestSource:'user'});f.complete();f.account('different-account');
  expect((await f.service.collect({now,requestSource:'scheduler'})).status).toBe('unavailable');expect(f.service.status().lastCompleteWatermark).toBeNull();
 }finally{f.store.close();}});
 it('deduplicates re-enumeration without promoting enumeration to semantic completeness',async()=>{const f=fixture();try{
  await f.service.enable({requestSource:'user'});f.complete();await f.service.collect({now,requestSource:'scheduler'});
  const first=f.service.status().lastCompleteWatermark;await f.service.collect({now,requestSource:'scheduler'});
  expect(f.service.latest().events).toHaveLength(1);expect(f.service.status().lastCompleteWatermark).toBe(first);
  f.service.disable({requestSource:'user'});expect(f.service.latest().events).toHaveLength(0);
 }finally{f.store.close();}});
});

describe('provider record observations',()=>{
 it('keeps provider record identity on time changes and never turns disappearance into cancellation',async()=>{
  const store=new LoopStore(':memory:');let records=[{...item}],fail=false;
  const source=new AssistantCalendarSource({store,connect:async()=>({binary:'/verified/yzj-cli',accountId:'one'}),read:async g=>{if(fail)throw Error('offline');return {records,accountId:g.accountId,grantEpoch:g.epoch,completeness:'unknown'};}});
  try{
   await source.enable({requestSource:'user'});
   const first=await source.collect({now,requestSource:'user'});
   fail=true;expect((await source.collect({now,requestSource:'user'})).status).toBe('unavailable');fail=false;
   records=[{...item,startDate:item.startDate+1000}];
   const second=await source.collect({now:now+1,requestSource:'user'});
   expect(second.events[0].id).toBe(first.events[0].id);
   expect(second.events[0].observationRevision).not.toBe(first.events[0].observationRevision);
   expect(second.observation).toMatchObject({identity:'provider_record',window:{from:now+1-86400000,to:now+1+7*86400000},observedAt:now+1,enumeration:'unknown',changed:[first.events[0].id]});
   records=[];const third=await source.collect({now:now+2,requestSource:'user'});
   expect(third.observation?.missingUnconfirmed).toEqual([first.events[0].id]);
   expect(third.events).toEqual([]);expect(source.status().lastCompleteWatermark).toBeNull();
  }finally{store.close();}
 });
 it('rejects contradictory duplicates instead of choosing the last record',async()=>{
  const store=new LoopStore(':memory:');const source=new AssistantCalendarSource({store,connect:async()=>({binary:'/verified/yzj-cli',accountId:'one'}),read:async g=>({records:[item,{...item,title:'different'}],accountId:g.accountId,grantEpoch:g.epoch,completeness:'complete'})});
  try{await source.enable({requestSource:'user'});expect((await source.collect({now,requestSource:'user'})).status).toBe('unavailable');}finally{store.close();}
 });
});

it('invalidates captured context and old bodies after revoke and account re-enable',async()=>{
 const f=fixture();try{
  await f.service.enable({requestSource:'user'});await f.service.collect({now,requestSource:'user'});
  const context=f.service.context();expect(context.read()?.events).toHaveLength(1);
  const epoch=f.service.status().epoch;f.service.disable({requestSource:'user'});
  expect(context.isCurrent()).toBe(false);expect(context.read()).toBeUndefined();
  f.account('second');await f.service.enable({requestSource:'user'});
  expect(f.service.status().epoch).toBeGreaterThan(epoch);expect(f.service.latest().events).toEqual([]);expect(context.read()).toBeUndefined();
 }finally{f.store.close();}
});

it('rolls generation insertion back when the final authorization guard fails',async()=>{
 const f=fixture();try{
  await f.service.enable({requestSource:'user'});const before=await f.service.collect({now,requestSource:'user'});
  let checks=0;
  expect(()=>f.store.writeAssistantCalendarGeneration({...before,collectedAt:now+1,events:[]},()=>++checks===1)).toThrow('grant_changed');
  expect(f.store.getAssistantCalendarGeneration(before.epoch)).toEqual(before);
 }finally{f.store.close();}
});
