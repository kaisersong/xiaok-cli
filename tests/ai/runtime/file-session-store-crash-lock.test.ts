import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ unavailable: false, attempts: 0 }));
vi.mock('node:module', async original => {
  const actual = await original<typeof import('node:module')>();
  return { ...actual, createRequire: (...args: Parameters<typeof actual.createRequire>) => {
    const require = actual.createRequire(...args);
    return (id: string) => { if (id === 'better-sqlite3') { native.attempts++; if (native.unavailable) throw new Error('native missing'); } return require(id); };
  } };
});
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir, hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); native.unavailable = false; native.attempts = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'solpi-file-lock-')); roots.push(root); return root; }
function snapshot() { return { ...new AgentSessionState().exportSnapshot(), sessionId: 'crash-test' }; }

describe('real FileSessionStore process crash ownership', () => {
  it('refuses a live writer then recovers its fully published marker after SIGKILL', async () => {
    const root = fixture();
    const code = `import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const originalUserInfo=os.userInfo.bind(os);os.userInfo=()=>({...originalUserInfo(),homedir:${JSON.stringify(userInfo().homedir)}});syncBuiltinESMExports();import {writeSync} from 'node:fs';const {FileSessionStore}=await import(${JSON.stringify(resolve('src/ai/runtime/session-store/file-store.ts'))});const store=new FileSessionStore(${JSON.stringify(root)},()=>{writeSync(1,'READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});await store.save(${JSON.stringify(snapshot())});`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close'); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(Error(`child not ready: ${stderr}`)), 10000);
        child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timer); resolveReady(); } });
        child.on('exit', () => { clearTimeout(timer); reject(Error(`child exited: ${stderr}`)); });
      });
      const lockPath = join(root, 'crash-test.json.save-lock');
      expect(existsSync(lockPath)).toBe(true);
      await expect(new FileSessionStore(root).save(snapshot())).rejects.toThrow();
      child.kill('SIGKILL'); await closed;
      await expect(new FileSessionStore(root).save(snapshot())).resolves.toBeUndefined();
      expect(existsSync(lockPath)).toBe(false);
      await expect(new FileSessionStore(root).load('crash-test')).resolves.toMatchObject({ sessionId: 'crash-test' });
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
  }, 20000);
  it.each(['', '{broken', JSON.stringify({ version: 1, pid: process.pid, hostname: hostname(), nonce: randomUUID() })])('preserves legacy, corrupt and live markers %s', async marker => {
    const root = fixture(), path = join(root, 'crash-test.json.save-lock'); writeFileSync(path, marker);
    await expect(new FileSessionStore(root).save(snapshot())).rejects.toThrow(); expect(readFileSync(path, 'utf8')).toBe(marker);
  });
  it('keeps ordinary Windows-compatible save pure JS when optional native cleanup is unavailable', async () => {
    const root = fixture(); native.unavailable = true;
    const store = new FileSessionStore(root, (path, text, options) => writeFileAtomicallySync(path, text, { ...options, platform: 'win32' }));
    await expect(store.save(snapshot())).resolves.toBeUndefined(); expect(native.attempts).toBe(0);
    const lock = join(root, 'crash-test.json.save-lock'); writeFileSync(lock, JSON.stringify({ version: 1, pid: 2147483647, hostname: hostname(), nonce: randomUUID() }));
    await expect(store.save(snapshot())).rejects.toThrow(); expect(existsSync(lock)).toBe(true);
  });
  it('never treats EPERM as a dead PID and never removes a replacement marker in finally', async () => {
    const root = fixture(), lock = join(root, 'crash-test.json.save-lock');
    const foreign = JSON.stringify({ version: 1, pid: 2147483647, hostname: hostname(), nonce: randomUUID() }); writeFileSync(lock, foreign);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    await expect(new FileSessionStore(root).save(snapshot())).rejects.toThrow(); expect(readFileSync(lock, 'utf8')).toBe(foreign); kill.mockRestore(); unlinkSync(lock);
    let replaced = false;
    const store = new FileSessionStore(root, (path, text, options) => {
      if (!replaced) { replaced = true; unlinkSync(lock); writeFileSync(lock, foreign); }
      writeFileAtomicallySync(path, text, options);
    });
    await expect(store.save(snapshot())).resolves.toBeUndefined(); expect(readFileSync(lock, 'utf8')).toBe(foreign);
  });
});
