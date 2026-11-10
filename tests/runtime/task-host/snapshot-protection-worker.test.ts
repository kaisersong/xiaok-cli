import { expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { waitFor } from '../../support/wait-for.js';

// Independent parent watchdog is essential: the old synchronous FIFO read
// blocks the child event loop, including its own timeout and abort handler.
function fixture(sourceInput = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapshot-protection-worker-')));
  const config = join(root, 'config'); mkdirSync(config);
  const entry = join(root, 'entry.mjs');
  writeFileSync(entry, `
    import * as fs from 'node:fs';
    import {createHook} from 'node:async_hooks';
    import {spawnSync} from 'node:child_process';
    import {join} from 'node:path';
    const {FileTaskSnapshotStore}=await import(${JSON.stringify(pathToFileURL(resolve(import.meta.url.endsWith('.js') ? '.test-dist/src/runtime/task-host/snapshot-store.js' : 'src/runtime/task-host/snapshot-store.ts')).href)});
    const {desktopObservationSessionId}=await import(${JSON.stringify(pathToFileURL(resolve(import.meta.url.endsWith('.js') ? '.test-dist/src/runtime/task-host/protected-observation-store.js' : 'src/runtime/task-host/protected-observation-store.ts')).href)});
    const root=${JSON.stringify(root)}, taskId='actual-protected-task';
    const closure={version:1,requiresReauthorization:true,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'a'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};
    const snapshot={taskId,sessionId:'original-session',status:'running',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1,protectedObservationClosure:closure};
    const writer=new FileTaskSnapshotStore(root);await writer.save(snapshot);
    const file=join(root,'protected-observation-sessions',desktopObservationSessionId(taskId)+'.json'),bytes=fs.readFileSync(file,'utf8');
    fs.unlinkSync(file);const fifo=spawnSync('mkfifo',[file]);process.send({kind:'synchronous-owned-child',pid:fifo.pid,code:fifo.status,signal:fifo.signal,reaped:true});if(fifo.status!==0)throw Error('mkfifo failed');
    const reader=new FileTaskSnapshotStore(root),controller=new AbortController(),reason=Error('original caller cancellation');
    const raw=[],rawErrors=[];let workers=0,read;
    // Observe the actual fixed Worker SDK birth. The protected Store deliberately
    // bypasses mutable public methods, so a public-method spy cannot identify IO.
    const workerHook=createHook({init(_id,type){if(type==='WORKER')workers++;}});workerHook.enable();
    const beat=setInterval(()=>process.send({kind:'heartbeat'}),20);
    process.on('message',async message=>{
      try {
        if(message.kind==='begin'){
          read=reader.${sourceInput ? 'readOriginalUserInput' : 'recoverTask'}(taskId,{signal:controller.signal,trackPending(work){
            raw.push(work);const id=raw.length,worker=workers;process.send({kind:'raw',id,worker});
            void work.then(()=>process.send({kind:'settled',id,worker,ok:true}),error=>{rawErrors.push(error);process.send({kind:'settled',id,worker,ok:false});});
          }}).then(()=>process.send({kind:'outcome',exact:false}),error=>process.send(${sourceInput ? "{kind:'outcome',exact:error===reason,aggregate:error instanceof AggregateError,controlCause:error.cause===reason,rawCause:error instanceof AggregateError&&error.errors.some(item=>rawErrors.includes(item))}" : "{kind:'outcome',exact:error===reason}"}));
        }
        if(message.kind==='abort')controller.abort(reason);
        if(message.kind==='probe-cache'){
          await read;await Promise.allSettled(raw);fs.unlinkSync(file);fs.writeFileSync(file,bytes);
          fs.rmSync(join(root,'snapshots',taskId+'.json'),{force:true});fs.rmSync(join(root,'snapshots',taskId+'.journal.jsonl'),{force:true});
          try{await reader.recoverTask(taskId);process.send({kind:'cache-probe',rejected:false});}
          catch(error){process.send({kind:'cache-probe',rejected:error.code==='SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'});}
        }
        if(message.kind==='finish'){await read;await Promise.allSettled(raw);workerHook.disable();clearInterval(beat);process.disconnect();}
      }catch(error){process.send({kind:'fixture-error',error:String(error)});}
    });
    process.send({kind:'ready',file,bytes});
  `);
  const child = spawn(process.execPath, ['--import', resolve('tests/support/profile-account-child.setup.mjs'),
    '--import', resolve('node_modules/tsx/dist/loader.mjs'), entry], {
    env: { ...process.env, XIAOK_CONFIG_DIR: config, XIAOK_TEST_ACCOUNT_HOME: root, XIAOK_TEST_RUNTIME_HOME: homedir() },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const events: Array<Record<string, any>> = []; let output = '';
  child.on('message', message => events.push(message as Record<string, any>));
  child.stdout!.on('data', data => { output += String(data); }); child.stderr!.on('data', data => { output += String(data); });
  const ownExit=(process:ChildProcess)=>new Promise<{pid:number|undefined;code:number|null;signal:NodeJS.Signals|null}>(yes=>process.once('exit',(code,signal)=>yes({pid:process.pid,code,signal})));
  const childExit=ownExit(child),writers:Array<{process:ChildProcess;exit:ReturnType<typeof ownExit>}>=[];
  const supply = (file: string, bytes: string) => {
    const writerEntry = join(root, `supply-${writers.length}.mjs`);
    writeFileSync(writerEntry, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(file)},${JSON.stringify(bytes)});`);
    const writer = spawn(process.execPath, [writerEntry], { stdio: 'ignore' }); writers.push({process:writer,exit:ownExit(writer)});
  };
  return { root, child, events, supply, output: () => output, cleanup: async () => {
    const owned=[{process:child,exit:childExit},...writers];
    const results=await Promise.all(owned.map(async item=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([item.exit,new Promise<void>(yes=>{timer=setTimeout(yes,2000);})]);}finally{if(timer)clearTimeout(timer);}
      if(item.process.exitCode===null&&item.process.signalCode===null)item.process.kill('SIGKILL');
      const result=await item.exit;console.log(JSON.stringify({test:'snapshot-protection-owned-child',sourceInput,...result,reaped:true}));return result;
    }));
    const synchronous=events.filter(event=>event.kind==='synchronous-owned-child');for(const item of synchronous)console.log(JSON.stringify({test:'snapshot-protection-owned-mkfifo',sourceInput,...item}));
    console.log(JSON.stringify({test:'snapshot-protection-owned-cleanup-count',sourceInput,count:results.length+synchronous.length}));
    rmSync(root, { recursive: true, force: true });
  } };
}

it.skipIf(process.platform === 'win32').each(['first', 'final'] as const)('actual %s protection FIFO keeps raw physical IO after cancellation and publishes no cache', async stage => {
  const f = fixture();
  try {
    await waitFor(() => expect(f.events.find(event => event.kind === 'ready'), f.output()).toBeTruthy(), { timeoutMs: 10000 });
    const ready = f.events.find(event => event.kind === 'ready')!;
    f.child.send({ kind: 'begin' });
    await waitFor(() => expect(f.events.find(event => event.kind === 'raw' && event.worker === 1), f.output()).toBeTruthy(), { timeoutMs: 2000 });
    if (stage === 'final') {
      f.supply(ready.file, ready.bytes);
      await waitFor(() => expect(f.events.find(event => event.kind === 'raw' && event.worker === 2), f.output()).toBeTruthy(), { timeoutMs: 10000 });
    }
    const worker = stage === 'first' ? 1 : 2;
    const beats = f.events.filter(event => event.kind === 'heartbeat').length;
    await waitFor(() => expect(f.events.filter(event => event.kind === 'heartbeat').length).toBeGreaterThan(beats), { timeoutMs: 2000 });
    f.child.send({ kind: 'abort' });
    await waitFor(() => expect(f.events.find(event => event.kind === 'outcome')).toEqual({ kind: 'outcome', exact: true }), { timeoutMs: 2000 });
    expect(f.events.some(event => event.kind === 'settled' && event.worker === worker)).toBe(false);
    if (stage === 'first') expect(f.events.filter(event => event.kind === 'raw')).toHaveLength(1);
    f.supply(ready.file, stage === 'first' ? '{invalid original sidecar' : ready.bytes);
    await waitFor(() => expect(f.events.find(event => event.kind === 'settled' && event.worker === worker)).toMatchObject({ ok: stage === 'final' }), { timeoutMs: 10000 });
    f.child.send({ kind: 'probe-cache' });
    await waitFor(() => expect(f.events.find(event => event.kind === 'cache-probe')).toEqual({ kind: 'cache-probe', rejected: true }), { timeoutMs: 10000 });
    expect(f.events.filter(event => event.kind === 'fixture-error'), f.output()).toEqual([]);
    f.child.send({ kind: 'finish' });
  } finally { await f.cleanup(); }
}, 30000);

it.skipIf(process.platform === 'win32').each(['first','final'] as const)('actual original source reader joins the %s protection FIFO before settling cancellation',async stage=>{
 const f=fixture(true);
 try{
  await waitFor(()=>expect(f.events.find(event=>event.kind==='ready'),f.output()).toBeTruthy(),{timeoutMs:10000});const ready=f.events.find(event=>event.kind==='ready')!;f.child.send({kind:'begin'});
  await waitFor(()=>expect(f.events.find(event=>event.kind==='raw'&&event.worker===1),f.output()).toBeTruthy(),{timeoutMs:2000});
  if(stage==='final'){f.supply(ready.file,ready.bytes);await waitFor(()=>expect(f.events.find(event=>event.kind==='raw'&&event.worker===2),f.output()).toBeTruthy(),{timeoutMs:10000});}
  const worker=stage==='first'?1:2,beats=f.events.filter(event=>event.kind==='heartbeat').length;f.child.send({kind:'abort'});
  await waitFor(()=>expect(f.events.filter(event=>event.kind==='heartbeat').length).toBeGreaterThan(beats+1),{timeoutMs:2000});expect(f.events.some(event=>event.kind==='outcome')).toBe(false);expect(f.events.some(event=>event.kind==='settled'&&event.worker===worker)).toBe(false);
  f.supply(ready.file,stage==='first'?'{invalid original sidecar':ready.bytes);
  await waitFor(()=>expect(f.events.find(event=>event.kind==='outcome'),f.output()).toMatchObject(stage==='first'?{aggregate:true,controlCause:true,rawCause:true}:{exact:true}),{timeoutMs:10000});
  expect(f.events.find(event=>event.kind==='settled'&&event.worker===worker)).toMatchObject({ok:stage==='final'});f.child.send({kind:'probe-cache'});
  await waitFor(()=>expect(f.events.find(event=>event.kind==='cache-probe'),f.output()).toEqual({kind:'cache-probe',rejected:true}),{timeoutMs:10000});expect(f.events.filter(event=>event.kind==='fixture-error'),f.output()).toEqual([]);f.child.send({kind:'finish'});
 }finally{await f.cleanup();}
},30000);
