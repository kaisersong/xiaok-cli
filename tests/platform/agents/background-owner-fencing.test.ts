import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createBackgroundRunner, type BackgroundRunner } from '../../../src/platform/agents/background-runner.js';

describe('background job cross-runner ownership', () => {
  let dir: string;
  const runners: BackgroundRunner[] = [];
  const children: ChildProcess[] = [];
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xiaok-background-owner-')); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(runners.splice(0).map((r) => r.dispose()));
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  function runner(execute: () => Promise<any> = async () => ({ ok: true }), notify: () => void = () => {}) {
    const result = createBackgroundRunner({ rootDir: dir, execute, notify, shutdownTimeoutMs: 5 });
    runners.push(result); return result;
  }
  const input = (sessionId: string) => ({ sessionId, source: 'review', input: sessionId });
  const disk = (id: string) => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  function seed(owner?: { id: string; pid: number }) {
    writeFileSync(join(dir, 'job_7.json'), JSON.stringify({ schemaVersion: 1, jobId: 'job_7', sessionId: 'old', source: 'test',
      inputSummary: 'legacy', status: 'running', createdAt: 1, updatedAt: 1, ownerId: owner?.id, ownerPid: owner?.pid }));
  }

  it('allocates globally distinct IDs and disposing A never overwrites B completed state', async () => {
    const a = runner(() => new Promise(() => {})); const b = runner();
    const ja = await a.start(input('a')); const jb = await b.start(input('b'));
    await vi.waitFor(() => expect(b.get(jb.jobId)?.status).toBe('completed'));
    expect(ja.jobId).not.toBe(jb.jobId);
    await a.dispose();
    expect(disk(jb.jobId)).toMatchObject({ sessionId: 'b', status: 'completed' });
  });

  it('creating another runner does not recover an active sibling in this process', async () => {
    const a = runner(() => new Promise(() => {})); const job = await a.start(input('a'));
    const b = runner();
    expect(b.get(job.jobId)?.status).toBe('running');
    expect(disk(job.jobId).status).toBe('running');
  });

  it.each(['EPERM', 'EINVAL'])('does not treat %s process inspection as proof of owner death', (code) => {
    seed({ id: 'unknown', pid: 555555 });
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    expect(runner().get('job_7')?.status).toBe('running');
    expect(disk('job_7').status).toBe('running');
  });

  it('only recovers confirmed missing owners and preserves old numeric IDs', () => {
    seed({ id: 'dead', pid: 555555 });
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); });
    expect(runner().get('job_7')).toMatchObject({ status: 'failed', errorMessage: 'background job interrupted by process restart' });
  });

  it('keeps ownerless legacy jobs unknown instead of falsely recovering a possibly live old CLI', () => {
    seed(); expect(runner().get('job_7')?.status).toBe('running');
    expect(disk('job_7').status).toBe('running');
  });

  it('fences late completion if durable owner identity changed', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const notify = vi.fn();
    const a = runner(async () => { await gate; return { ok: true }; }, notify);
    const job = await a.start(input('a'));
    const foreign = { ...disk(job.jobId), ownerId: 'foreign', ownerPid: process.pid, status: 'completed', resultSummary: 'foreign result' };
    writeFileSync(join(dir, `${job.jobId}.json`), JSON.stringify(foreign));
    finish(); await new Promise(setImmediate);
    expect(disk(job.jobId)).toEqual(foreign);
    expect(notify).not.toHaveBeenCalled();
  });

  it('preserves a real external process owner and recovers after that process exits', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      'import {createBackgroundRunner} from "./src/platform/agents/background-runner.ts"; const runner=createBackgroundRunner({rootDir:process.argv[1],execute:()=>new Promise(()=>{}),notify:()=>{}}); const job=await runner.start({sessionId:"child",source:"test",input:"live"}); console.log(job.jobId); setInterval(()=>{},1000);', dir],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const [line] = await once(child.stdout!, 'data');
    const id = String(line).trim();
    expect(runner().get(id)?.status).toBe('running');
    const exited = once(child, 'exit'); child.kill(); await exited;
    expect(runner().get(id)?.status).toBe('failed');
  });
});
