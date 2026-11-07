import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ActivitySourceSupervisor } from '../../../src/runtime/conversation-activity/source-supervisor.js';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'activity-supervisor-'));
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const entryPath = join(root, 'server.mjs');
  writeFileSync(entryPath, `import{createServer}from'node:http';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const server=createServer((req,res)=>res.end(JSON.stringify({ok:true,ipcConnected:process.connected===true,service:{pid:process.pid,entryPath:process.argv[1],entryHash:createHash('sha256').update(readFileSync(process.argv[1])).digest('hex')}})));server.listen(${address.port},'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  return { root, source: { name: 'kswarm' as const, executable: process.execPath, entryPath, cwd: root, env: {}, healthUrl: `http://127.0.0.1:${address.port}/health`, expectedHealth: { ok: true, 'service.entryPath': entryPath, 'service.entryHash': createHash('sha256').update(readFileSync(entryPath)).digest('hex') } } };
}
describe('native source supervisor process ownership', () => {
  it('an idle parent can still exit after unref of its actual supervised child',async()=>{
    const f=await fixture(),url=pathToFileURL(resolve('src/runtime/conversation-activity/source-supervisor.ts')).href;
    const program=`import {ActivitySourceSupervisor} from ${JSON.stringify(url)};const source=JSON.parse(process.argv[1]);const s=new ActivitySourceSupervisor(source.cwd,'parent-lifecycle');console.log(JSON.stringify(await s.ensure(source)));`;
    const parent=spawn(process.execPath,['--import','tsx','--input-type=module','-e',program,JSON.stringify(f.source)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let output='',errors='';parent.stdout!.on('data',chunk=>{output+=String(chunk);});parent.stderr!.on('data',chunk=>{errors+=String(chunk);});
    const closed=new Promise<void>(yes=>parent.once('close',()=>yes()));let receipt:{pid:number;birth:string}|undefined;
    try{
      await vi.waitFor(()=>{expect(output.trim(),errors).not.toBe('');},{timeout:5000});receipt=JSON.parse(output.trim());console.log(JSON.stringify({test:'supervisor-parent-idle-exit',parentPid:parent.pid,child:receipt}));
      await vi.waitFor(()=>expect(parent.exitCode).toBe(0),{timeout:1000});await closed;
    }finally{
      if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGTERM');await closed;
      if(receipt)await new ActivitySourceSupervisor(f.root,'parent-lifecycle').stopOwned('kswarm','parent-lifecycle');
      rmSync(f.root,{recursive:true,force:true});
    }
  },15000);
  it.each(['kswarm','broker'] as const)('opens inherited IPC only for its actual %s spawn without adding a public control handle',async name=>{
    const f=await fixture();const supervisor=new ActivitySourceSupervisor(f.root,'original');let receipt:Awaited<ReturnType<typeof supervisor.ensure>>|undefined;
    try{
      receipt=await supervisor.ensure({...f.source,name});console.log(JSON.stringify({test:'supervisor-stdio',name,pid:receipt.pid,birth:receipt.birth,ownerEpoch:receipt.ownerEpoch}));
      expect((await (await fetch(f.source.healthUrl)).json()).ipcConnected).toBe(name==='kswarm');
      expect(Object.keys(receipt).sort()).toEqual(['birth','entryHash','external','name','ownerEpoch','pid']);
      expect(Object.keys(supervisor)).not.toContain('send');
    }finally{if(receipt)await supervisor.stopOwned(name,'original');await supervisor.sealAndDrainSpawned();if(receipt)expect(()=>process.kill(receipt.pid,0)).toThrow();rmSync(f.root,{recursive:true,force:true});}
  },15000);

  it('actual KS startup with the inherited channel alone never installs a writer floor',async()=>{
    const f=await fixture(),entry=resolve('../kswarm/src/server/index.js'),data=join(f.root,'ks-data'),supervisor=new ActivitySourceSupervisor(f.root,'real-ks');let receipt:Awaited<ReturnType<typeof supervisor.ensure>>|undefined;
    try{
      receipt=await supervisor.ensure({...f.source,entryPath:entry,cwd:dirname(dirname(dirname(entry))),env:{HOME:f.root,USERPROFILE:f.root,KSWARM_DATA_ROOT:data,KSWARM_PORT:new URL(f.source.healthUrl).port,BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_PROFILE_ID:'a'.repeat(64),KSWARM_DESKTOP_WORKSPACE_ID:'b'.repeat(64)},expectedHealth:{ok:true,'service.entryPath':entry,'service.entryHash':createHash('sha256').update(readFileSync(entry)).digest('hex')}});
      console.log(JSON.stringify({test:'supervisor-actual-ks-no-grant',pid:receipt.pid,birth:receipt.birth,ownerEpoch:receipt.ownerEpoch}));
      const db=new DatabaseSync(join(data,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(0);}finally{db.close();}
    }finally{if(receipt)await supervisor.stopOwned('kswarm','real-ks');await supervisor.sealAndDrainSpawned();if(receipt)expect(()=>process.kill(receipt.pid,0)).toThrow();rmSync(f.root,{recursive:true,force:true});}
  },15000);
  it('single-flights launch, persists birth and entry identity, transfers only verified ownership and rejects an old stop lease', async () => {
    const f = await fixture(); let pid: number | undefined;
    try {
      const first = new ActivitySourceSupervisor(f.root, 'first');
      const [a,b] = await Promise.all([first.ensure(f.source), first.ensure(f.source)]); pid = a.pid;
      expect(a).toEqual(b); expect(a.external).toBe(false); expect(await first.protectedPid(a.pid)).toBe(true);
      const restored = new ActivitySourceSupervisor(f.root, 'second');
      expect(await restored.ensure(f.source)).toMatchObject({ pid: a.pid, birth: a.birth, ownerEpoch: 'second' });
      await expect(first.stopOwned('kswarm','first')).rejects.toThrow('activity_source_stale_lease');
      await expect(restored.stopOwned('kswarm','first')).rejects.toThrow('activity_source_stale_lease');
      await restored.stopOwned('kswarm','second');
      expect(() => process.kill(a.pid,0)).toThrow();
    } finally { if (pid) { try { process.kill(pid,'SIGTERM'); } catch {} } rmSync(f.root,{recursive:true,force:true}); }
  },15_000);
  it('restarts a confirmed dead owned source without treating a reused PID or altered entry as takeover permission', async () => {
    const f = await fixture(); let pid: number | undefined;
    try {
      const first = new ActivitySourceSupervisor(f.root,'first'); const a = await first.ensure(f.source); pid = a.pid;
      process.kill(a.pid,'SIGTERM'); await vi.waitFor(() => expect(() => process.kill(a.pid,0)).toThrow());
      const restored = new ActivitySourceSupervisor(f.root,'second'); await new ActivitySourceSupervisor(f.root,'first').stopOwned('kswarm','first'); const b = await restored.ensure(f.source); pid = b.pid;
      expect(b.pid).not.toBe(a.pid); expect(b.external).toBe(false);
      writeFileSync(f.source.entryPath,readFileSync(f.source.entryPath,'utf8')+'\n// changed');
      await expect(restored.ensure(f.source)).rejects.toThrow('activity_source_identity_mismatch');
      await restored.stopOwned('kswarm','second');
    } finally { if (pid) { try { process.kill(pid,'SIGTERM'); } catch {} } rmSync(f.root,{recursive:true,force:true}); }
  },15_000);
});
