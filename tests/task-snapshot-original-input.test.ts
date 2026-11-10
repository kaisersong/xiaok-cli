import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopObservationSessionId} from '../src/runtime/task-host/protected-observation-store.js';
import {FileTaskSnapshotStore,recoverTaskSnapshotSync} from '../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../src/runtime/task-host/types.js';
const io=vi.hoisted(()=>({read:undefined as undefined|((path:unknown)=>Promise<string>|undefined)}));
vi.mock('node:fs/promises',async(importOriginal)=>{const original=await importOriginal<typeof import('node:fs/promises')>();return{...original,readFile:(...args:unknown[])=>io.read?.(args[0])??Reflect.apply(original.readFile,undefined,args)};});
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{io.read=undefined;for(const cleanup of cleanups.splice(0))await cleanup();});
function fixture(){const root=mkdtempSync(join(tmpdir(),'original-task-input-')),store=new FileTaskSnapshotStore(root);cleanups.push(async()=>{await store.closeAndDrain();rmSync(root,{recursive:true,force:true});});return{root,store};}
const snapshot:TaskSnapshot={taskId:'source-task',sessionId:'source-session',status:'understanding',prompt:'Original retained user input',materials:[],events:[],context:{threadId:'source-thread'},executionScope:{kind:'goal_turn',origin:'user',goalId:'goal',epoch:1,goalTurnId:'turn',threadId:'source-thread'},createdAt:1,updatedAt:1};
function read(store:FileTaskSnapshotStore){const method=Reflect.get(store,'readOriginalUserInput');expect(typeof method).toBe('function');return Reflect.apply(method,store,[snapshot.taskId]) as Promise<unknown>;}
it('the original snapshot owner returns only the actual retained source fields from its native persisted input',async()=>{
 const f=fixture();await f.store.save(snapshot);expect(await read(f.store)).toEqual({taskId:snapshot.taskId,sessionId:snapshot.sessionId,threadId:'source-thread',prompt:snapshot.prompt,executionScope:snapshot.executionScope});
});
it('a retained cache cannot recreate the original input after its actual checkpoint and journal were removed',async()=>{
 const f=fixture();await f.store.save(snapshot);expect((await f.store.recoverTask(snapshot.taskId))?.prompt).toBe(snapshot.prompt);rmSync(join(f.root,'snapshots',snapshot.taskId+'.json'));rmSync(join(f.root,'snapshots',snapshot.taskId+'.journal.jsonl'),{force:true});
 expect((await f.store.recoverTask(snapshot.taskId))?.prompt).toBe(snapshot.prompt);expect(await read(f.store)).toBeNull();
});
it('source reading observes current physical prompt bytes rather than a previous cached snapshot value',async()=>{
 const f=fixture();await f.store.save(snapshot);await f.store.recoverTask(snapshot.taskId);const path=join(f.root,'snapshots',snapshot.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.prompt='Different current persisted bytes';writeFileSync(path,JSON.stringify(value));
 expect((await f.store.recoverTask(snapshot.taskId))?.prompt).toBe(snapshot.prompt);expect(await read(f.store)).toMatchObject({prompt:'Different current persisted bytes'});
});
for(const lateError of [false,true])it(`an aborted original source read joins its admitted raw IO and preserves late failure=${lateError}`,async()=>{
 const f=fixture();await f.store.save(snapshot);const bytes=readFileSync(join(f.root,'snapshots',snapshot.taskId+'.json'),'utf8'),controller=new AbortController(),control=Error('original source revoked'),physical=Error('actual read tail failed');
 let enter!:()=>void,resolve!:(value:string)=>void,reject!:(error:unknown)=>void;const entered=new Promise<void>(yes=>{enter=yes;}),raw=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
 io.read=path=>{if(path===join(f.root,'snapshots',snapshot.taskId+'.json')){enter();return raw;}return undefined;};
 let settled=false;const pending=f.store.readOriginalUserInput(snapshot.taskId,{signal:controller.signal,trackPending(){}}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
 await entered;controller.abort(control);await new Promise<void>(yes=>setImmediate(yes));expect(settled).toBe(false);if(lateError)reject(physical);else resolve(bytes);
 const outcome=await pending;expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome){if(lateError){expect(outcome.error).toBeInstanceOf(AggregateError);expect(outcome.error.cause).toBe(control);expect(Array.isArray(outcome.error.errors)).toBe(true);expect(outcome.error.errors[0]).toBe(control);expect(outcome.error.errors[1]).toBe(physical);}else expect(outcome.error).toBe(control);}
});
it('the source owner refuses a physically mismatched task identity without blessing a cached row',async()=>{
 const f=fixture();await f.store.save(snapshot);const path=join(f.root,'snapshots',snapshot.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.taskId='another-task';writeFileSync(path,JSON.stringify(value));await expect(read(f.store)).rejects.toThrow('task_original_input_invalid');
});
it('a partial original journal tail is read without repairing or truncating either retained file',async()=>{
 const f=fixture();await f.store.save(snapshot);const checkpoint=join(f.root,'snapshots',snapshot.taskId+'.json'),journal=join(f.root,'snapshots',snapshot.taskId+'.journal.jsonl'),before=readFileSync(checkpoint,'utf8'),fragment='{"incomplete":';writeFileSync(journal,fragment);
 expect(await read(f.store)).toMatchObject({prompt:snapshot.prompt});expect(readFileSync(checkpoint,'utf8')).toBe(before);expect(readFileSync(journal,'utf8')).toBe(fragment);
});
it.each(['../foreign','foreign/row','foreign\\row','C:\\outside\\row','C:relative','\\\\server\\share\\row','.','..'])('original source identifiers never become platform paths: %s',async id=>{
 const f=fixture();await expect(f.store.readOriginalUserInput(id)).rejects.toThrow('task_original_input_invalid');
});
it('the original input reader preserves current protected provenance instead of stripping it from a plain prompt',async()=>{
 const f=fixture(),closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'a'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};
 await f.store.save({...snapshot,protectedObservationClosure:closure});const value=await f.store.readOriginalUserInput(snapshot.taskId);expect(value?.protectedObservationClosure).toEqual(closure);expect(value?.prompt).toBe(snapshot.prompt);
});
it('a forged checkpoint task id is refused before any second native protection lookup can target that other task',async()=>{
 const f=fixture();await f.store.save(snapshot);const path=join(f.root,'snapshots',snapshot.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.taskId='foreign-original-task';writeFileSync(path,JSON.stringify(value));const spy=vi.spyOn(f.store.observations,'readProtectionInWorker');await expect(f.store.readOriginalUserInput(snapshot.taskId)).rejects.toThrow('task_original_input_invalid');expect(spy.mock.calls.filter(args=>args[0]!==snapshot.taskId)).toHaveLength(0);
});
for(const method of ['readOriginalUserInput','recoverTask'] as const)it(`the original ${method} cannot forget protection already read before its current checkpoint await`,async()=>{
 const f=fixture();await f.store.save(snapshot);const closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'22222222-2222-2222-2222-222222222222',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'b'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};await f.store.observations.save(snapshot.taskId,closure);
 const reader=new FileTaskSnapshotStore(f.root);cleanups.push(()=>reader.closeAndDrain());let weakened=false;const checkpoint=join(f.root,'snapshots',snapshot.taskId+'.json'),sidecar=join(f.root,'protected-observation-sessions',desktopObservationSessionId(snapshot.taskId)+'.json');
 io.read=path=>{if(path===checkpoint&&!weakened){weakened=true;rmSync(sidecar);}return undefined;};
 const value=await reader[method](snapshot.taskId,{signal:new AbortController().signal,trackPending(){}});expect(weakened).toBe(true);expect(value?.protectedObservationClosure).toEqual(closure);
});
for(const mode of ['async','sync'] as const)it(`the original ${mode} sibling refuses a checkpoint belonging to a different task`,async()=>{
 const f=fixture();await f.store.save(snapshot);const path=join(f.root,'snapshots',snapshot.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.taskId='foreign-sibling-task';writeFileSync(path,JSON.stringify(value));
 if(mode==='sync')expect(()=>recoverTaskSnapshotSync(f.root,snapshot.taskId)).toThrow('task_snapshot_completion_owner');
 else{const reader=new FileTaskSnapshotStore(f.root);cleanups.push(()=>reader.closeAndDrain());const spy=vi.spyOn(reader.observations,'readProtectionInWorker');await expect(reader.recoverTask(snapshot.taskId,{signal:new AbortController().signal,trackPending(){}})).rejects.toThrow('task_snapshot_completion_owner');expect(spy.mock.calls.filter(args=>args[0]!==snapshot.taskId)).toHaveLength(0);}
});
for(const method of ['readOriginalUserInput','recoverTask'] as const)it(`the same original ${method} owner retains a known restriction across later reads without its sidecar`,async()=>{
 const f=fixture();await f.store.save(snapshot);const closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'33333333-3333-3333-3333-333333333333',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'c'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};await f.store.observations.save(snapshot.taskId,closure);
 const reader=new FileTaskSnapshotStore(f.root);cleanups.push(()=>reader.closeAndDrain());const first=await reader[method](snapshot.taskId,{signal:new AbortController().signal,trackPending(){}});expect(first?.protectedObservationClosure).toEqual(closure);rmSync(join(f.root,'protected-observation-sessions',desktopObservationSessionId(snapshot.taskId)+'.json'));const second=await reader[method](snapshot.taskId,{signal:new AbortController().signal,trackPending(){}});expect(second?.protectedObservationClosure).toEqual(closure);
});

for(const method of ['readOriginalUserInput','recoverTask'] as const)it(`the same original ${method} remembers accepted checkpoint-only protection after a later file downgrade`,async()=>{
 const f=fixture(),closure={version:1 as const,requiresReauthorization:true as const,observations:[{authorityId:'44444444-4444-4444-4444-444444444444',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'d'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};await f.store.save({...snapshot,executionProtected:true,protectedObservationClosure:closure});
 rmSync(join(f.root,'protected-observation-sessions',desktopObservationSessionId(snapshot.taskId)+'.json'));
 const reader=new FileTaskSnapshotStore(f.root);cleanups.push(()=>reader.closeAndDrain());const first=await reader[method](snapshot.taskId,{signal:new AbortController().signal,trackPending(){}});expect(first?.protectedObservationClosure).toEqual(closure);expect(first?.executionProtected).toBe(true);
 const path=join(f.root,'snapshots',snapshot.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));delete value.executionProtected;delete value.protectedObservationClosure;writeFileSync(path,JSON.stringify(value));
 const second=await reader.readOriginalUserInput(snapshot.taskId,{signal:new AbortController().signal,trackPending(){}});expect(second?.protectedObservationClosure).toEqual(closure);expect(second?.executionProtected).toBe(true);
});
