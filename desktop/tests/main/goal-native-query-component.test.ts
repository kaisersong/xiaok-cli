// @vitest-environment node
// Whole original query ONLY; no old mixed Goal suite/native workflow execution ticket.
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/query-register',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[]},clipboard:{},dialog:{},shell:{}}));
import { queryFixture, queryRecord } from '../support/goal-native-query-fixture.js';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const fixtures:Array<Awaited<ReturnType<typeof queryFixture>>>=[];
async function fixture(){resetIpcSchemaRegistryForTests();const f=await queryFixture();fixtures.push(f);return f;}
afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.close();});
it('original registered IPC owns the tuple and fs-read output contract',async()=>{
 const f=await fixture();expect(IPC_SCHEMA_REGISTRY.get('desktop:goal:getNativeMutation')).toMatchObject({payloadMode:'tuple',sourceFile:'desktop/electron/goal-native-query-typed-ipc.ts',riskTags:['fs-read']});
 await expect(f.invoke()).resolves.toBeNull();expect(f.gate.outstanding).toBe(0);expect(f.forbiddenHostCalls()).toBe(0);
});
it('complete real query trims original input and reads only four summary fields from the last retained row',async()=>{
 const f=await fixture(),a=queryRecord('old'),b=queryRecord('latest');f.write([a,b]);const bytes=readFileSync(f.file);
 await expect(f.invoke([{threadId:' thread '}])).resolves.toEqual({id:'latest',kind:'create',status:'reserved',objective:'Original query'});
 expect(readFileSync(f.file)).toEqual(bytes);expect(f.forbiddenHostCalls()).toBe(0);
});
it.each(['reserved','enrolling','enrolled','binding','ready','applied','retired','stale'] as const)('real FileJournal reads %s as historical data, never current approval',async status=>{
 const f=await fixture();f.write([{...queryRecord(),status}]);expect(await f.invoke()).toEqual({id:'summary',kind:'create',status,objective:'Original query'});expect(f.forbiddenHostCalls()).toBe(0);
});
it('whole replacement summary uses the same real parser/projection',async()=>{
 const f=await fixture(),r=queryRecord();f.write([{...r,kind:'replace',target:{...r.target,epoch:2},previous:{goalId:'goal',epoch:1,revision:1,createdAt:500,forkedFromGoalId:null,stateHash:'b'.repeat(64)}}]);
 expect(await f.invoke()).toEqual({id:'summary',kind:'replace',status:'reserved',objective:'Original query'});
});
it('empty existing journal returns null and validates every retained row, not just last',async()=>{
 const f=await fixture();f.write([]);await expect(f.invoke()).resolves.toBeNull();f.write([{...queryRecord('bad'),target:{}},queryRecord('last')]);await expect(f.invoke()).rejects.toThrow();expect(f.gate.outstanding).toBe(0);
});
it.each([[],[{threadId:'thread'},{}],[undefined],[{threadId:''}],[{threadId:'x'.repeat(201)}],[{threadId:'thread',requestSource:'user'}]].map(args=>({args})))('rejects malformed tuple/input before journal reads: %j',async ({args})=>{
 const f=await fixture();const load=vi.spyOn(f.journal,'load');await expect(f.invoke(args)).rejects.toThrow();expect(load).not.toHaveBeenCalled();expect(f.gate.outstanding).toBe(0);
});
it('capture rejects input accessor/proxy without invoking either trap',async()=>{
 const f=await fixture();let calls=0;const payload=Object.defineProperty({},'threadId',{enumerable:true,get(){calls++;return 'thread';}});
 for(const input of [payload,new Proxy({threadId:'thread'},{ownKeys(){calls++;return ['threadId'];}})]) await expect(f.invoke([input])).rejects.toThrow('goal_native_query_input_invalid');expect(calls).toBe(0);
});
it('actual finer Main authorization denies recorder, wrong frame/URL and missing authority before input getters',async()=>{
 const f=await fixture();let reads=0;const input=Object.defineProperty({},'threadId',{enumerable:true,get(){reads++;return 'thread';}});
 for(const event of [{sender:f.recorder,senderFrame:f.frame},{sender:f.target,senderFrame:{url:f.frame.url}}]) await expect(f.invoke([input],event)).rejects.toThrow();
 f.frame.url='https://untrusted.invalid/';await expect(f.invoke([input])).rejects.toThrow();expect(reads).toBe(0);expect(f.gate.outstanding).toBe(0);
});
it.each(['invalid-json','invalid-utf8','oversize','cross-session','invalid-first-row','too-many-records'])('real bounded FileJournal propagates %s failures and drains',async mode=>{
 const f=await fixture();f.write([queryRecord()]);
 if(mode==='invalid-json')writeFileSync(f.file,'{');
 if(mode==='invalid-utf8')writeFileSync(f.file,Buffer.from([0xff]));
 if(mode==='oversize')writeFileSync(f.file,' '.repeat(2*1024**2+1));
 if(mode==='cross-session')writeFileSync(f.file,JSON.stringify({version:1,sessionId:'foreign',records:[]}));
 if(mode==='invalid-first-row')f.write([{...queryRecord('bad'),definition:{}},queryRecord('last')]);
 if(mode==='too-many-records')f.write(Array.from({length:33},(_,i)=>queryRecord('id'+i)));
 await expect(f.invoke()).rejects.toThrow();expect(f.gate.outstanding).toBe(0);expect(f.forbiddenHostCalls()).toBe(0);
});
it.skipIf(process.platform==='win32')('NOFOLLOW rejects a journal symlink instead of escaping the query root',async()=>{
 const f=await fixture();f.write([queryRecord()]);const target=f.file+'.target';writeFileSync(target,readFileSync(f.file));unlinkSync(f.file);symlinkSync(target,f.file);await expect(f.invoke()).rejects.toThrow();expect(f.gate.outstanding).toBe(0);
});
it('closed coordinator and shutdown gate reject without journal reads',async()=>{
 const f=await fixture(),load=vi.spyOn(f.journal,'load');f.coordinator.stopAccepting();await expect(f.invoke()).rejects.toThrow('goal_coordinator_closed');f.gate.close();await expect(f.invoke()).rejects.toThrow(/shutting_down/);expect(load).not.toHaveBeenCalled();expect(f.gate.outstanding).toBe(0);
});
it('ambient species/constructor tampering is rejected BEFORE query IO, separately characterizing existing wrapper Await',async()=>{
 const f=await fixture(),load=vi.spyOn(f.journal,'load');let speciesReads=0,constructorReads=0;
 for(const [owner,key] of [[Promise,Symbol.species],[Promise.prototype,'constructor']] as const){
  const saved=Object.getOwnPropertyDescriptor(owner,key)!;
  Object.defineProperty(owner,key,{configurable:saved.configurable,enumerable:saved.enumerable,get(){if(key===Symbol.species)speciesReads++;else constructorReads++;return Promise;}});
  let pending:Promise<unknown>;try{pending=f.invoke();}finally{Object.defineProperty(owner,key,saved);}
  await expect(pending!).rejects.toThrow('goal_native_query_projection_unavailable');
 }
 // The entire unchanged wrapper Await reads constructor, unlike descriptor capture/preflight.
 expect(speciesReads).toBe(0);expect(constructorReads).toBeGreaterThan(0);expect(load).not.toHaveBeenCalled();expect(f.gate.outstanding).toBe(0);
});

it('original whole getter also permits absent optional journal without a substitute implementation',async()=>{
 resetIpcSchemaRegistryForTests();const f=await queryFixture(false);fixtures.push(f);await expect(f.invoke()).resolves.toBeNull();expect(f.forbiddenHostCalls()).toBe(0);
});

it('real producer summary reaches both original ChatShell query consumers without inferring current approval',async()=>{
 const f=await fixture();f.write([queryRecord()]);const row=await f.invoke();
 const source=readFileSync(new URL('../../renderer/src/components/ChatShell.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('ChatShell.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let initial:ts.ArrowFunction|undefined,refresh:ts.ArrowFunction|undefined;
 const visit=(n:ts.Node)=>{
  if(ts.isCallExpression(n)&&n.expression.getText(ast).startsWith('desktop.getGoalNativeMutation?.(taskId).then')){
   if(n.arguments[0]&&ts.isArrowFunction(n.arguments[0]))initial=n.arguments[0];
  }
  if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='refreshGoalNative'&&n.initializer&&ts.isArrowFunction(n.initializer))refresh=n.initializer;
  ts.forEachChild(n,visit);
 };visit(ast);if(!initial||!refresh)throw Error('actual_query_consumer_source_missing');
 const js=(node:ts.Node)=>ts.transpileModule(`return (${node.getText(ast)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const set=vi.fn();let live=true;
 const first=compileFunction(js(initial),['initialCurrent','setGoalNativeMutation'])(()=>live,set) as (value:unknown)=>void;
 first(row);expect(set).toHaveBeenLastCalledWith(row);live=false;first(null);expect(set).toHaveBeenCalledTimes(1);
 const attempt={};const second=compileFunction(js(refresh),['getDesktopApi','taskId','currentAttempt','setGoalNativeMutation'])(()=>({getGoalNativeMutation:()=>f.invoke()}),'thread',(value:unknown)=>value===attempt,set) as (attempt:unknown)=>Promise<void>;
 await second(attempt);expect(set).toHaveBeenLastCalledWith(row);await second({});expect(set).toHaveBeenCalledTimes(2);
});
