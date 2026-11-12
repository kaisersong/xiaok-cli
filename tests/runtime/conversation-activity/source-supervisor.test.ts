import { describe, it, expect, vi } from 'vitest';
// Only the birth lookup (execFile) can be made to fail; spawn stays real.
const birthFault=vi.hoisted(()=>({fail:false,pids:[] as number[]}));
vi.mock('node:child_process',async importOriginal=>{
  const real=await importOriginal<typeof import('node:child_process')>();
  return {...real,execFile:((file:string,args:string[],options:unknown,callback:(error:Error|null,stdout:string,stderr:string)=>void)=>{
    if(!birthFault.fail)return (real.execFile as unknown as (...a:unknown[])=>unknown)(file,args,options,callback);
    const pid=Number(/(\d+)/.exec(args.join(' '))?.[1]);birthFault.pids.push(pid);
    setImmediate(()=>callback(new Error('injected birth lookup failure'),'',''));return undefined;
  }) as unknown as typeof real.execFile};
});
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
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
// The real KS child needs Node >= 22.22.0 (kswarm runtime-guard). CI must name
// it explicitly; a local run may use its own Node only when that is new enough.
function kswarmTestNode():string{
  const name='XIAOK_WORKFLOW_TEST_KSWARM_NODE_EXECUTABLE',set=process.env[name];
  if(!set&&process.env.GITHUB_ACTIONS)throw new Error(`kswarm_test_node_missing: ${name} is not set (KS child needs Node >= 22.22.0)`);
  const executable=set||process.execPath;
  const version=set?execFileSync(executable,['-p','process.versions.node'],{encoding:'utf8'}).trim():process.versions.node;
  const [major,minor]=version.split('.').map(Number);
  if(major<22||(major===22&&minor<22))throw new Error(`kswarm_test_node_missing: ${set?name:'process.execPath (no '+name+')'} is Node ${version}, KS child needs Node >= 22.22.0`);
  console.log(JSON.stringify({test:'supervisor-actual-ks-node',executable,version,fromEnv:Boolean(set)}));
  return executable;
}
describe('native source supervisor process ownership', () => {
  it('preserves a healthy external Broker and ensures a new owned instance after it disappears', async () => {
    const f = await fixture();
    const observerRoot = mkdtempSync(join(tmpdir(), 'activity-external-broker-'));
    const source = { ...f.source, name: 'broker' as const };
    const original = new ActivitySourceSupervisor(f.root, 'original');
    const observer = new ActivitySourceSupervisor(observerRoot, 'observer');
    const pids: number[] = [];
    try {
      const first = await original.ensure(source); pids.push(first.pid);
      expect(await observer.ensure(source)).toMatchObject({ external: true, pid: 0 });
      await expect(observer.stopOwned('broker', 'observer')).rejects.toThrow('activity_source_stop_unconfirmed');
      expect((await fetch(source.healthUrl)).ok).toBe(true);
      await original.stopOwned('broker', 'original');
      const restored = await observer.ensure(source); pids.push(restored.pid);
      expect(restored).toMatchObject({ external: false, ownerEpoch: 'observer' });
      expect(restored.pid).not.toBe(first.pid);
      expect(await observer.protectedPid(restored.pid)).toBe(true);
      await observer.stopOwned('broker', 'observer');
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
        await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
      }
      rmSync(f.root, { recursive: true, force: true });
      rmSync(observerRoot, { recursive: true, force: true });
    }
  }, 15_000);
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

  it.each(['kswarm','broker'] as const)('reaps its actual %s child when the birth lookup fails after spawn',async name=>{
    const f=await fixture(),supervisor=new ActivitySourceSupervisor(f.root,'birth-fault');
    birthFault.fail=true;birthFault.pids.length=0;
    try{await expect(supervisor.ensure({...f.source,name})).rejects.toThrow('activity_source_birth_unavailable');}finally{birthFault.fail=false;}
    const [pid]=birthFault.pids;expect(pid).toBeGreaterThan(0);
    let exitCode='alive';try{process.kill(pid,0);}catch(error){exitCode=(error as NodeJS.ErrnoException).code??'gone';}
    console.log(JSON.stringify({test:'supervisor-birth-fault-reap',name,pid,birthError:'activity_source_birth_unavailable',afterReject:exitCode}));
    try{expect(exitCode).toBe('ESRCH');}finally{try{process.kill(pid,'SIGKILL');}catch{}}
    await supervisor.sealAndDrainSpawned();
    // The child no longer holds the root as its cwd: removal needs no retry.
    expect(()=>rmSync(f.root,{recursive:true})).not.toThrow();
  },15000);
  it('actual KS startup with the inherited channel alone never installs a writer floor',async()=>{
    const f=await fixture(),entry=resolve('../kswarm/src/server/index.js'),data=join(f.root,'ks-data'),supervisor=new ActivitySourceSupervisor(f.root,'real-ks');let receipt:Awaited<ReturnType<typeof supervisor.ensure>>|undefined;
    try{
      receipt=await supervisor.ensure({...f.source,executable:kswarmTestNode(),entryPath:entry,cwd:dirname(dirname(dirname(entry))),env:{HOME:f.root,USERPROFILE:f.root,KSWARM_DATA_ROOT:data,KSWARM_PORT:new URL(f.source.healthUrl).port,BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_PROFILE_ID:'a'.repeat(64),KSWARM_DESKTOP_WORKSPACE_ID:'b'.repeat(64)},expectedHealth:{ok:true,'service.entryPath':entry,'service.entryHash':createHash('sha256').update(readFileSync(entry)).digest('hex')}});
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
  it('kills a spawned source that never answers health within the start budget and releases its port', async () => {
    const f = await fixture();
    const port = Number(new URL(f.source.healthUrl).port), pidFile = join(f.root, 'unhealthy.pid');
    // Listens like a slow cold-start Broker but never completes a /health response.
    const entryPath = join(f.root, 'unhealthy.mjs');
    writeFileSync(entryPath, `import{createServer}from'node:http';import{writeFileSync}from'node:fs';createServer(()=>{}).listen(${port},'127.0.0.1',()=>writeFileSync(${JSON.stringify(pidFile)},String(process.pid)));`);
    const source = { ...f.source, name: 'broker' as const, entryPath, expectedHealth: { ok: true } };
    const supervisor = new ActivitySourceSupervisor(f.root, 'owner');
    let pid: number | undefined;
    try {
      await expect(supervisor.ensure(source)).rejects.toThrow('activity_source_start_timeout');
      pid = Number(readFileSync(pidFile, 'utf8'));
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid!, 0)).toThrow();
      const ledger = JSON.parse(readFileSync(join(f.root, 'activity-source-supervision.json'), 'utf8')) as { sources: unknown[] };
      expect(ledger.sources).toEqual([]);
      const probe = createServer();
      await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      await new Promise<void>(resolve => probe.close(() => resolve()));
    } finally { if (pid) { try { process.kill(pid,'SIGKILL'); } catch {} } rmSync(f.root,{recursive:true,force:true}); }
  },20_000);
});
