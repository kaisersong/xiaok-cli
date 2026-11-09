// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const nativePrepare=DatabaseSync.prototype.prepare,nativeRun=StatementSync.prototype.run;
afterEach(()=>{vi.restoreAllMocks();});
it.each(['before','after'] as const)('preserves a real SDK bare-undefined write fault %s NativeRun and rolls back actual bytes',async mode=>{
 vi.resetModules();const statements=new WeakMap<object,string>();let faults=0;
 vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){const statement=Reflect.apply(nativePrepare,this,[sql]);statements.set(statement,sql);return statement;});
 vi.spyOn(StatementSync.prototype,'run').mockImplementation(function(this:StatementSync,...args:unknown[]){if(statements.get(this)?.startsWith('INSERT INTO assistant_calendar_generations')){faults++;if(mode==='after')Reflect.apply(nativeRun,this,args);throw undefined;}return Reflect.apply(nativeRun,this,args);});
 const {LoopStore}=await import('../../electron/loop-store.js'),{AssistantCalendarSource}=await import('../../electron/assistant-calendar-source.js'),{AssistantYzjClient}=await import('../../electron/assistant-yzj-cli.js');
 const now=Date.parse('2026-11-09T00:00:00Z'),path=join(mkdtempSync(join(tmpdir(),'calendar-sdk-write-')),'loop.sqlite'),store=new LoopStore(path),source=new AssistantCalendarSource({store,cloud:new AssistantYzjClient({run:async args=>args[0]==='whoami'?{success:true,data:{orgId:'org',openId:'self'}}:{success:true,data:{list:[{id:'a',title:'Original',startDate:now,endDate:now+1}],count:1,more:false}}})});
 try{
  await source.enable({requestSource:'user'});let first:{present:true;raw:unknown}|undefined;
  try{await source.collect({now,requestSource:'user'});}catch(raw){first={present:true,raw};}
  expect(first).toEqual({present:true,raw:undefined});expect(faults).toBe(1);
  const read=new DatabaseSync(path,{readOnly:true});try{expect(read.prepare('SELECT count(*) AS n FROM assistant_calendar_generations').get()!.n).toBe(0);expect(read.prepare('SELECT epoch FROM assistant_calendar_connection').get()!.epoch).toBe(1);}finally{read.close();}
 }finally{try{await source.close();}finally{store.close();}}
});
