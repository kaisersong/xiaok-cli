// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {AssistantYzjClient} from '../../electron/assistant-yzj-cli.js';
const from=Date.parse('2026-11-09T00:00:00Z'),to=from+8*86400000;
const actor={success:true,data:{orgId:'org',openId:'self'}};
const record={id:'event-1',title:'Review',startDate:from+1,endDate:from+2,timeZone:'Asia/Shanghai'};
function fixture(data:unknown={list:[record],more:false,count:1}){
 const run=vi.fn(async(args:string[])=>args[0]==='whoami'?actor:{success:true,data});
 const cloud=new AssistantYzjClient({run});return {run,cloud};
}
// A readonly provider enumeration never proves occurrence/all-day/cancellation
// semantics. The Source layer must continue to publish a partial observation.
describe('fixed bundled calendar observation transport',()=>{
 it('preserves the full 160-character observation and the half-open millisecond window',async()=>{
  const row={...record,title:'x'.repeat(160),cancelDate:from+1,allDay:true};const {cloud,run}=fixture({list:[row],count:1,more:false});
  const expected=await cloud.identity(),result=await cloud.observeCalendar({from,to},expected);
  expect(result).toEqual({records:[row],accountId:expected,window:{from,to},completeness:'complete'});
  expect(run.mock.calls.map(([args])=>args)).toEqual([['whoami'],['whoami'],['calendar','event','list','--start',String(from),'--end',String(to-1)],['whoami']]);
  expect(result).not.toHaveProperty('allDay');expect(result).not.toHaveProperty('cancelled');
 });
 it.each([{}, {more:true}, {more:false,count:2}, {more:false,total:2},{more:false,pageToken:'next'}])('preserves provider enumeration uncertainty %j',async flags=>{
  const {cloud}=fixture({list:[record],count:1,...flags}),identity=await cloud.identity();
  expect((await cloud.observeCalendar({from,to},identity)).completeness).toBe(Object.keys(flags).length?'partial':'unknown');
 });
 it.each([{count:0},{count:-1},{total:0},{more:'false'},{pageToken:1},{list:[null]},{list:Array(201).fill(record)}])('rejects malformed or oversized provider receipts %j',async patch=>{
  const {cloud}=fixture({list:[record],count:1,more:false,...patch}),identity=await cloud.identity();
  await expect(cloud.observeCalendar({from,to},identity)).rejects.toThrow('assistant_calendar_observation_invalid');
 });
 it('never promotes an exact provider page limit to complete even with more=false',async()=>{
  const {cloud}=fixture({list:Array.from({length:200},(_,i)=>({...record,id:String(i)})),more:false,count:200});
  expect((await cloud.observeCalendar({from,to},await cloud.identity())).completeness).toBe('partial');
 });
 it('represents a one-millisecond half-open window with its one inclusive timestamp',async()=>{
  const {cloud,run}=fixture({list:[],count:0,more:false});
  expect((await cloud.observeCalendar({from,to:from+1},await cloud.identity())).window).toEqual({from,to:from+1});
  expect(run.mock.calls.find(([args])=>args[0]==='calendar')![0]).toEqual(['calendar','event','list','--start',String(from),'--end',String(from)]);
 });
 it('does not read after cancellation during account inspection',async()=>{
  const {cloud,run}=fixture(),identity=await cloud.identity(),controller=new AbortController();
  run.mockImplementation(async args=>{if(args[0]==='whoami')controller.abort(Error('stopped'));return actor;});
  await expect(cloud.observeCalendar({from,to},identity,controller.signal)).rejects.toThrow('stopped');
  expect(run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(0);
 });
 it('bounds raw bytes without logging or truncating provider records',async()=>{
  const {cloud}=fixture({list:[{...record,extra:'x'.repeat(1024*1024)}]}),identity=await cloud.identity();
  await expect(cloud.observeCalendar({from,to},identity)).rejects.toThrow('assistant_calendar_observation_invalid');
 });
 it.each([{from,to:from},{from:0,to},{from:from+.5,to},{from,to:to+1},{from,to,profile:'other'},{from,to,endpoint:'http://other'}])('rejects invalid windows and caller routing before IO %j',async window=>{
  const {cloud,run}=fixture();await expect(cloud.observeCalendar(window,'a'.repeat(64))).rejects.toThrow('assistant_calendar_observation_invalid');expect(run).not.toHaveBeenCalled();
 });
 it('rejects account replacement before calendar IO and after the actual list',async()=>{
  const a=fixture(),identity=await a.cloud.identity();a.run.mockImplementation(async args=>args[0]==='whoami'?{success:true,data:{orgId:'org',openId:'other'}}:{success:true,data:{list:[]}});
  await expect(a.cloud.observeCalendar({from,to},identity)).rejects.toThrow('assistant_account_changed');expect(a.run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(0);
  const b=fixture();const expected=await b.cloud.identity();let listed=false;
  b.run.mockImplementation(async args=>{if(args[0]==='calendar'){listed=true;return {success:true,data:{list:[record]}};}return listed?{success:true,data:{orgId:'org',openId:'other'}}:actor;});
  await expect(b.cloud.observeCalendar({from,to},expected)).rejects.toThrow('assistant_account_changed');expect(b.run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(1);
 });
 it('observes cancellation after provider completion without starting another request',async()=>{
  const {cloud,run}=fixture(),identity=await cloud.identity(),controller=new AbortController();
  run.mockImplementation(async args=>{if(args[0]==='calendar'){controller.abort(Error('cancelled'));return {success:true,data:{list:[record]}};}return actor;});
  await expect(cloud.observeCalendar({from,to},identity,controller.signal)).rejects.toThrow('cancelled');expect(run.mock.calls.filter(([args])=>args[0]==='calendar')).toHaveLength(1);
 });
 it('keeps the original query and user-only create protocol independent from observation semantics',async()=>{
  const {cloud,run}=fixture({count:102,list:[{...record,content:'notes'}]});
  expect(await cloud.listCalendar({startDate:'2026-11-09',endDate:'2026-11-09'})).toMatchObject({partial:true,items:[{id:'event-1',title:'Review',description:'notes'}]});
  expect(run.mock.calls.map(([args])=>args)).toEqual([['whoami'],['calendar','event','list','--start=2026-11-09','--end=2026-11-09'],['whoami']]);
  for(const source of ['agent','scheduler',undefined])await expect(cloud.createCalendar({},'ignored',source as never)).rejects.toThrow('assistant_user_only');
 });
});
