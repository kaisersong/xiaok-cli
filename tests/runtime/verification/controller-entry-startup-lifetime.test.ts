import {it,expect} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import Native from 'better-sqlite3';
const entry=fileURLToPath(new URL('../../../src/runtime/verification/controller-entry.ts',import.meta.url)),loader=fileURLToPath(new URL('./controller-entry-startup-loader.mjs',import.meta.url));
async function child(mode:string){
 const root=mkdtempSync(join(tmpdir(),'eh-')),child=spawn(process.execPath,['--import',loader,'--import','tsx',entry],{env:{...process.env,SOLPI_ENTRY_TEST_MODE:mode,SOLPI_ENTRY_TEST_ROOT:root},stdio:['ignore','ignore','pipe','ipc']});
 let pending=false,closes=0,stderr='';child.stderr!.on('data',data=>{stderr+=data;});
 child.on('message',data=>{if(data&&typeof data==='object'&&'event' in data){if(data.event==='pending')pending=true;if(data.event==='close')closes++;}});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 async function until(test:()=>boolean){for(let i=0;i<100;i++){if(test())return;await wait(20);}throw Error('entry startup boundary timeout '+stderr);}
 function locked(){const db=new Native(join(root,'controller-owner.sqlite'),{timeout:0});try{try{db.exec('BEGIN EXCLUSIVE');db.exec('ROLLBACK');return false;}catch(error){if(error instanceof Error&&/locked/.test(error.message))return true;throw error;}}finally{db.close();}}
 return {root,child,exited,until,locked,pending:()=>pending,closes:()=>closes,stderr:()=>stderr};
}
async function dispose(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));child.kill('SIGKILL');await closed;}}
// POSIX cooperative signals only; no installed OS engine or physical guest leaf.
it.skipIf(process.platform==='win32').each(['pending-success','pending-rejected','pending-unresolved'])(
 'retains the real startup lock with no other referenced child handle, then handles %s',async mode=>{
  const f=await child(mode);
  try{
   await f.until(f.pending);await wait(100);expect(f.child.exitCode).toBeNull();expect(f.child.signalCode).toBeNull();expect(f.locked()).toBe(true);
   f.child.kill('SIGTERM');f.child.kill('SIGINT');await wait(100);expect(f.child.exitCode).toBeNull();expect(f.child.signalCode).toBeNull();expect(f.locked()).toBe(true);
   f.child.send('release');
   if(mode==='pending-success'){expect(await f.exited).toEqual({code:0,signal:null});expect(f.closes()).toBe(1);expect(f.locked()).toBe(false);}
   else if(mode==='pending-rejected'){expect(await f.exited).toEqual({code:1,signal:null});expect(f.closes()).toBe(0);expect(f.locked()).toBe(false);}
   else{
    await f.until(()=>f.stderr().includes('start_rejected'));f.child.kill('SIGTERM');await wait(100);
    expect(f.child.exitCode).toBeNull();expect(f.child.signalCode).toBeNull();expect(f.locked()).toBe(true);expect(f.closes()).toBe(0);
   }
  }finally{await dispose(f.child);rmSync(f.root,{recursive:true,force:true});}
 });
