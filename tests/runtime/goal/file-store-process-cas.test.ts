import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';

const roots: string[] = [], children: Array<{ child: ChildProcess; done: Promise<{ code: number | null; stderr: string }> }> = [];
afterEach(async () => {
  for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(children.splice(0).map(row => row.done));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'goal-process-cas-')); roots.push(root);
  const store = new FileGoalStore(root), state = createGoalState({ sessionId: 'session', objective: 'original', expectedEvidenceKinds: ['answer'], now: 1 });
  await store.commit({ sessionId: 'session', expectedRevision: null, next: state, events: [], turns: [], evidence: [] });
  const script = join(root, 'writer.mjs'), entered = join(root, 'entered'), release = join(root, 'release');
  writeFileSync(script, `
import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const originalUserInfo=os.userInfo.bind(os);os.userInfo=()=>({...originalUserInfo(),homedir:${JSON.stringify(userInfo().homedir)}});syncBuiltinESMExports();
const {FileGoalStore}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/runtime/goal/file-store.ts')).href)});
import { writeFileAtomicallySync } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/utils/atomic-file.ts')).href)};
import { existsSync, writeFileSync } from 'node:fs';
const root=${JSON.stringify(root)}, entered=${JSON.stringify(entered)}, release=${JSON.stringify(release)};
const hold=process.argv[2]==='hold';
const store=new FileGoalStore(root,(path,data)=>{
 if(hold){writeFileSync(entered,'entered');const end=Date.now()+15000;while(!existsSync(release)){if(Date.now()>end)throw Error('fixture release deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}
 writeFileAtomicallySync(path,data);
});
const original=await store.load('session');
await store.commit({sessionId:'session',expectedRevision:original.state.revision,next:{...original.state,revision:original.state.revision+1,objective:hold?'first':'second'},events:[],turns:[],evidence:[]});
`);
  function writer(hold: boolean) {
    const child = spawn(process.execPath, ['--import', 'tsx', script, hold ? 'hold' : 'write'], { cwd: process.cwd(), stdio: ['ignore','ignore','pipe'] });
    let stderr = ''; child.stderr!.on('data', data => { stderr += data; });
    const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      child.once('error', reject); child.once('close', code => resolve({ code, stderr }));
    });
    const processState = { child, done }; children.push(processState); return processState;
  }
  return { root, store, state, entered, release, writer };
}
it('two actual Node processes cannot both pass the same FileGoalStore read/modify/write window', async () => {
  const f = await fixture(), first = f.writer(true);
  try {
    await vi.waitFor(() => expect(existsSync(f.entered)).toBe(true), { timeout: 10000 });
    const second = await f.writer(false).done;
    expect(second.code, second.stderr).not.toBe(0);
    expect(second.stderr).toMatch(/session_save_locked/);
  } finally { writeFileSync(f.release, 'release'); }
  expect((await first.done).code).toBe(0);
  expect((await new FileGoalStore(f.root).load('session'))!.state).toMatchObject({ revision: 2, objective: 'first' });
}, 30000);
it('a real killed writer leaves only its original dead lock, which a restarted actual store can recover', async () => {
  const f = await fixture(), first = f.writer(true);
  await vi.waitFor(() => expect(existsSync(f.entered)).toBe(true), { timeout: 10000 });
  expect(existsSync(join(f.root, '.goal-store.save.lock'))).toBe(true);
  first.child.kill('SIGKILL'); await first.done;
  const restarted = new FileGoalStore(f.root);
  await restarted.commit({ sessionId: 'session', expectedRevision: 1, next: { ...f.state, revision: 2, objective: 'recovered' }, events: [], turns: [], evidence: [] });
  expect((await restarted.load('session'))!.state.objective).toBe('recovered');
  expect(existsSync(join(f.root, '.goal-store.save.lock'))).toBe(false);
}, 30000);
it('a long-lived store in another Node process rereads an actual competing commit and then passes fresh CAS', async () => {
  const f = await fixture(), ready = join(f.root, 'long-ready'), release = join(f.root, 'long-release'), script = join(f.root, 'long-writer.mjs');
  writeFileSync(script, `
import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const originalUserInfo=os.userInfo.bind(os);os.userInfo=()=>({...originalUserInfo(),homedir:${JSON.stringify(userInfo().homedir)}});syncBuiltinESMExports();
const {FileGoalStore}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/runtime/goal/file-store.ts')).href)});
import { existsSync, writeFileSync } from 'node:fs';
const store=new FileGoalStore(${JSON.stringify(f.root)});await store.load('session');writeFileSync(${JSON.stringify(ready)},'ready');
const deadline=Date.now()+15000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('fixture deadline');await new Promise(r=>setTimeout(r,20));}
const current=(await store.load('session')).state;await store.commit({sessionId:'session',expectedRevision:current.revision,next:{...current,revision:current.revision+1,objective:'long-child'},events:[],turns:[],evidence:[]});
`);
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: process.cwd(), stdio: ['ignore','ignore','pipe'] });
  let stderr = ''; child.stderr!.on('data', data => { stderr += data; });
  const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve({ code, stderr })); });
  children.push({ child, done });
  await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 10000 });
  await f.store.commit({ sessionId: 'session', expectedRevision: 1, next: { ...f.state, revision: 2, objective: 'parent' }, events: [], turns: [], evidence: [] });
  writeFileSync(release, 'release'); const result = await done; expect(result.code, result.stderr).toBe(0);
  const current = (await f.store.load('session'))!.state; expect(current).toMatchObject({ revision: 3, objective: 'long-child' });
  await f.store.commit({ sessionId: 'session', expectedRevision: 3, next: { ...current, revision: 4 }, events: [], turns: [], evidence: [] });
}, 30000);
