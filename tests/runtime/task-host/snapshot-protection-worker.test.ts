import { expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { waitFor } from '../../support/wait-for.js';

// Independent parent watchdog is essential: the old synchronous FIFO read
// blocks the child event loop, including its own timeout and abort handler.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapshot-protection-worker-')));
  const config = join(root, 'config'); mkdirSync(config);
  const entry = join(root, 'entry.mjs');
  writeFileSync(entry, `
    import * as fs from 'node:fs';
    import {spawnSync} from 'node:child_process';
    import {join} from 'node:path';
    const {FileTaskSnapshotStore}=await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/task-host/snapshot-store.ts')).href)});
    const {desktopObservationSessionId}=await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/task-host/protected-observation-store.ts')).href)});
    const root=${JSON.stringify(root)}, taskId='actual-protected-task';
    const closure={version:1,requiresReauthorization:true,observations:[{authorityId:'11111111-1111-1111-1111-111111111111',profileId:'actual-profile',sourceSessionId:'original-session',ownerAgentId:'original-agent',scopeId:'original-scope',permissionGeneration:1,observationId:'original-observation',contentHash:'a'.repeat(64),revision:1,policyId:'original-policy',policyRevision:1}]};
    const snapshot={taskId,sessionId:'original-session',status:'running',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1,protectedObservationClosure:closure};
    const writer=new FileTaskSnapshotStore(root);await writer.save(snapshot);
    const file=join(root,'protected-observation-sessions',desktopObservationSessionId(taskId)+'.json'),bytes=fs.readFileSync(file,'utf8');
    fs.unlinkSync(file);if(spawnSync('mkfifo',[file]).status!==0)throw Error('mkfifo failed');
    const reader=new FileTaskSnapshotStore(root),controller=new AbortController(),reason=Error('original caller cancellation');
    const raw=[],workerIds=new Map();let workers=0,read;
    const original=reader.observations.readProtectionInWorker;
    if(original)reader.observations.readProtectionInWorker=function(...args){const work=original.apply(this,args);workerIds.set(work,++workers);return work;};
    const beat=setInterval(()=>process.send({kind:'heartbeat'}),20);
    process.on('message',async message=>{
      try {
        if(message.kind==='begin'){
          read=reader.recoverTask(taskId,{signal:controller.signal,trackPending(work){
            raw.push(work);const id=raw.length,worker=workerIds.get(work)||0;process.send({kind:'raw',id,worker});
            void work.then(()=>process.send({kind:'settled',id,worker,ok:true}),()=>process.send({kind:'settled',id,worker,ok:false}));
          }}).then(()=>process.send({kind:'outcome',exact:false}),error=>process.send({kind:'outcome',exact:error===reason}));
        }
        if(message.kind==='abort')controller.abort(reason);
        if(message.kind==='probe-cache'){
          await read;await Promise.allSettled(raw);fs.unlinkSync(file);fs.writeFileSync(file,bytes);
          fs.rmSync(join(root,'snapshots',taskId+'.json'),{force:true});fs.rmSync(join(root,'snapshots',taskId+'.journal.jsonl'),{force:true});
          try{await reader.recoverTask(taskId);process.send({kind:'cache-probe',rejected:false});}
          catch(error){process.send({kind:'cache-probe',rejected:error.code==='SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'});}
        }
        if(message.kind==='finish'){await read;await Promise.allSettled(raw);clearInterval(beat);process.disconnect();}
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
  const writers: ChildProcess[] = [];
  const supply = (file: string, bytes: string) => {
    const writerEntry = join(root, `supply-${writers.length}.mjs`);
    writeFileSync(writerEntry, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(file)},${JSON.stringify(bytes)});`);
    const writer = spawn(process.execPath, [writerEntry], { stdio: 'ignore' }); writers.push(writer);
  };
  return { root, child, events, supply, output: () => output, cleanup: async () => {
    child.kill('SIGKILL'); for (const writer of writers) writer.kill('SIGKILL');
    await new Promise<void>(yes => child.exitCode !== null || child.signalCode !== null ? yes() : child.once('exit', () => yes()));
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
