import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { ActivitySourceSupervisor } from '../../../src/runtime/conversation-activity/source-supervisor.js';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'activity-supervisor-'));
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const entryPath = join(root, 'server.mjs');
  writeFileSync(entryPath, `import{createServer}from'node:http';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const server=createServer((req,res)=>res.end(JSON.stringify({ok:true,service:{pid:process.pid,entryPath:process.argv[1],entryHash:createHash('sha256').update(readFileSync(process.argv[1])).digest('hex')}})));server.listen(${address.port},'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  return { root, source: { name: 'kswarm' as const, executable: process.execPath, entryPath, cwd: root, env: {}, healthUrl: `http://127.0.0.1:${address.port}/health`, expectedHealth: { ok: true, 'service.entryPath': entryPath, 'service.entryHash': createHash('sha256').update(readFileSync(entryPath)).digest('hex') } } };
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
