// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {lstatSync,realpathSync,existsSync,rmSync} from 'node:fs';
import type {Stats} from 'node:fs';

const fixture=vi.hoisted(()=>({
 failure:Error('owned fixture compilation failed'),
 allocated:[] as Array<{root:string;identity:Stats}>,
 compilerCalls:0,
}));
vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 return {...actual,mkdtempSync(...args:Parameters<typeof actual.mkdtempSync>){
  const value=Reflect.apply(actual.mkdtempSync,actual,args);
  if(typeof value!=='string')throw Error('fixture allocation path required');
  const root=actual.realpathSync(value);
  fixture.allocated.push({root,identity:actual.lstatSync(root)});
  return value;
 }};
});
vi.mock('esbuild',async importOriginal=>{
 const actual=await importOriginal<typeof import('esbuild')>();
 return {...actual,build(){fixture.compilerCalls++;return Promise.reject(fixture.failure);}};
});
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:child_process')>();
 return {...actual,execFile(...args:unknown[]){
  fixture.compilerCalls++;
  const callback=args.at(-1);
  if(typeof callback!=='function')throw Error('fixture compiler callback required');
  queueMicrotask(()=>callback(fixture.failure,'',''));
 }};
});
import {compileVerifierEntry} from '../fixtures/desktop-post-seal-verifier-contract.js';
import {compileProtectionWorkerEntry} from '../fixtures/desktop-protection-worker-entry.js';

it.each(['delivery','protection'] as const)('publishes the actual %s compilation root before a failing compiler and retains it for its owner',async kind=>{
 const first=fixture.allocated.length,calls=fixture.compilerCalls;
 const acquired:Array<{root:string;identity:Stats}>=[];
 const onAcquired=(root:string)=>{
  // This is the owning caller's first synchronous operation, before any await.
  acquired.push({root:realpathSync(root),identity:lstatSync(root)});
  expect(fixture.compilerCalls).toBe(calls);
 };
 const compile=kind==='delivery'
  ?()=>compileVerifierEntry('delivery-verifier-worker.ts',{onAcquired})
  :()=>compileProtectionWorkerEntry({onAcquired});
 const outcomes:Array<{root:string;alreadyRemoved:boolean}>=[];
 let bodyFailure:{error:unknown}|undefined;
 const cleanupFailures:unknown[]=[];
 try{
  await expect(compile()).rejects.toBe(fixture.failure);
  expect(fixture.compilerCalls-calls).toBe(1);
  expect(acquired).toHaveLength(1);
  const observed=fixture.allocated.slice(first);
  expect(observed).toHaveLength(1);
  expect(acquired[0].root).toBe(observed[0].root);
  expect(acquired[0].identity.ino).toBe(observed[0].identity.ino);
  expect(existsSync(acquired[0].root)).toBe(true);
 }catch(error){bodyFailure={error};}finally{
  // Only compiler leaves reject; no child or Worker is started by these leaves.
  // Preserve the original fixture outcome, then remove each exact observed root.
  for(const {root,identity} of fixture.allocated.slice(first)){
   try{
   const present=existsSync(root);outcomes.push({root,alreadyRemoved:!present});
   if(!present)continue;
   const current=lstatSync(root);
   expect(current.isDirectory()&&!current.isSymbolicLink()).toBe(true);
   expect(realpathSync(root)).toBe(root);
   for(const key of ['uid','dev','ino','birthtimeMs'] as const)expect(current[key]).toBe(identity[key]);
   rmSync(root,{recursive:true,force:false});
   }catch(error){cleanupFailures.push(error);}
  }
  try{console.info('QUALIFIED_COMPILER_ALLOCATION_CLEANUP',JSON.stringify({kind,roots:outcomes,actualCompilerChildren:0,actualWorkers:0}));}
  catch(error){cleanupFailures.push(error);}
 }
 if(cleanupFailures.length)throw new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...cleanupFailures],'qualified_compiler_allocation_and_cleanup_failed',{cause:bodyFailure?bodyFailure.error:cleanupFailures[0]});
 if(bodyFailure)throw bodyFailure.error;
});
