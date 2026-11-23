// @vitest-environment node
import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ContinuitySdkCustody} from '../../electron/context-continuity/sdk-custody.js';

it.each(['sdk','input'])('reclaims completed %s call records after actual GC instead of growing with call count',mode=>{
 const module=new URL('../../electron/context-continuity/sdk-custody.js',import.meta.url);if(!existsSync(module))module.pathname=module.pathname.replace(/\.js$/,'.ts');
 const child=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=512','--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,fileURLToPath(new URL('../../../tests/support/custody-memory-probe.mjs',import.meta.url)),module.href,mode],{encoding:'utf8',timeout:30000});
 expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout.trim());expect(proof.calls).toBe(20000);expect(proof.physicalKnown).toBe(true);expect(proof.growth).toBeLessThan(48*1024*1024);
},35000);
it('keeps a real pending async producer until it actually finishes',async()=>{
 const sdk=new ContinuitySdkCustody();let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});const work=sdk.invoke(()=>gate,undefined,[]);expect(()=>sdk.assertKnown()).toThrow();finish();await work;await sdk.waitKnown();expect(()=>sdk.assertKnown()).not.toThrow();
});
it('retains an actual pending tail returned by a synchronous producer',async()=>{
 const sdk=new ContinuitySdkCustody();let finish!:()=>void;const tail=new Promise<void>(resolve=>{finish=resolve;});expect(()=>sdk.invokeSync(()=>({tail}),undefined,[])).toThrow();for(let i=0;i<50;i++)sdk.invokeSync(()=>undefined,undefined,[]);expect(()=>sdk.assertKnown()).toThrow();finish();await sdk.waitKnown();expect(()=>sdk.assertKnown()).not.toThrow();
});
it('preserves the original rejection and its unfinished cause',async()=>{
 const sdk=new ContinuitySdkCustody();let finish!:()=>void;const tail=new Promise<void>(resolve=>{finish=resolve;}),original=new Error('producer_failed',{cause:tail});expect(()=>sdk.invokeSync(()=>{throw original;},undefined,[])).toThrow(original);expect(()=>sdk.assertKnown()).toThrow();finish();await sdk.waitKnown();
});
it('continues observing callback metadata after completed calls have been reclaimed',async()=>{
 const sdk=new ContinuitySdkCustody(),fn=()=>undefined;sdk.invokeSync(fn,undefined,[]);let finish!:()=>void;const tail=new Promise<void>(resolve=>{finish=resolve;});Object.defineProperty(fn,'later',{value:tail});expect(()=>sdk.assertKnown()).toThrow();finish();await sdk.waitKnown();
});
it('never lets replaced array removal methods discard an unknown record',()=>{
 const sdk=new ContinuitySdkCustody(),unknown=new Proxy({},{});expect(()=>sdk.invokeSync(()=>unknown,undefined,[])).toThrow();
 const keys=['lastIndexOf','splice'] as const,originals=keys.map(key=>Object.getOwnPropertyDescriptor(Array.prototype,key)!);let calls=0;
 try{for(const key of keys)Object.defineProperty(Array.prototype,key,{...Object.getOwnPropertyDescriptor(Array.prototype,key),value(){calls++;return 0;}});sdk.invokeSync(()=>undefined,undefined,[]);expect(calls).toBe(0);expect(()=>sdk.assertKnown()).toThrow();}finally{keys.forEach((key,index)=>Object.defineProperty(Array.prototype,key,originals[index]!));}
});
