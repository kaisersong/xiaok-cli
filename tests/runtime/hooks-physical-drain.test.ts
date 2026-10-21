import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHooksRunner } from '../../src/runtime/hooks-runner.js';
import { waitFor } from '../support/wait-for.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

it.skipIf(process.platform === 'win32').each([false, true])('drains the actual %s async command after its original child close', async async => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hooks-physical-'))),entered=join(root,'entered'),gate=join(root,'gate'),script=join(root,'hook.cjs');
 cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(script,`const fs=require('node:fs');process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(entered+'.cancel')},'original signal received'));process.stdin.resume();fs.writeFileSync(${JSON.stringify(entered)},'entered');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);process.stdout.write('original terminal output');process.exit(0);}},5);`);
 const runner=createHooksRunner({hooks:[{command:`exec ${quote(process.execPath)} ${quote(script)}`,events:['SessionStart'],async,timeoutMs:20000}]});
 const running=runner.runHooks('SessionStart',{});cleanups.push(async()=>{writeFileSync(gate,'cleanup');await running;});await waitFor(()=>expect(existsSync(entered)).toBe(true));
 if(async)expect(await running).toMatchObject({ok:true,async:true});
 let ended=false;const closing=runner.closeAndDrain().then(()=>{ended=true;});
 cleanups.push(async()=>{writeFileSync(gate,'cleanup');await closing;});
 expect(runner.closeAndDrain()).toBe(runner.closeAndDrain());
 await new Promise(r=>setTimeout(r,40));expect(ended).toBe(false);
 await waitFor(()=>expect(existsSync(entered+'.cancel')).toBe(true));
 expect(await runner.runHooks('SessionStart',{})).toMatchObject({ok:false});
 writeFileSync(gate,'finish actual command');await closing;await running;expect(ended).toBe(true);
},30000);

it('waits for every original prompt even after a peer rejects and retains consumed unknown errors',async()=>{
 let enter!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r),failure=Error('original prompt failed');
 const runner=createHooksRunner({hooks:[{type:'prompt',events:['SessionStart'],prompt:'$ARGUMENTS'}],promptExecutor:async prompt=>{if(JSON.parse(prompt).fail)throw failure;enter();await held;return '{"ok":true}';}});
 await runner.runHooks('SessionStart',{fail:true});const running=runner.runHooks('SessionStart',{fail:false});await ready;
 let settled=false;const closing=runner.closeAndDrain().then(()=>{settled=true;return null;},e=>{settled=true;return e;});
 expect(runner.closeAndDrain()).toBe(runner.closeAndDrain());await new Promise(r=>setTimeout(r,30));expect(settled).toBe(false);
 release();await running;const error=await closing;expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([failure]);expect(error.errors[0]).toBe(failure);
});

it('closes an actual HTTP transport and does not execute its private final hook when host admission denies',async()=>{
 let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);const server=createServer((_req,res)=>{entered();res.on('error',()=>{});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
 const port=(server.address() as {port:number}).port;
 const runner=createHooksRunner({hooks:[{type:'http',url:`http://127.0.0.1:${port}/`,events:['SessionStart']}],finalHookAdmission:()=>undefined});
 const running=runner.runHooks('SessionStart',{});await ready;await runner.closeAndDrain();await running;
 expect(await runner.runHooks('SessionEnd',{})).toMatchObject({ok:false});
});

it('checks actual final admission after accepted work drains and runs SessionEnd exactly once',async()=>{
 let release!:()=>void,enter!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>enter=r);const events:string[]=[];
 const runner=createHooksRunner({hooks:[{type:'prompt',prompt:'$ARGUMENTS',events:['SessionStart','SessionEnd']}],promptExecutor:async text=>{const event=JSON.parse(text).hook_event_name;events.push(event);if(event==='SessionStart'){enter();await held;}return '{"ok":true}';},finalHookAdmission:()=>{expect(events).toEqual(['SessionStart']);return {reason:'original-host-finalizer'};}});
 const running=runner.runHooks('SessionStart',{});await ready;const closing=runner.closeAndDrain();expect(runner.closeAndDrain()).toBe(closing);release();await closing;await running;expect(events).toEqual(['SessionStart','SessionEnd']);await runner.closeAndDrain();expect(events).toEqual(['SessionStart','SessionEnd']);
});
