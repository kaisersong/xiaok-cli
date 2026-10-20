// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHarnessOptimizationRuntime } from '../../electron/harness-optimization-service.js';
import { harnessOwnerPlatformQualified } from '../../electron/harness-optimization-owner-lock.js';
const children: Array<{ process: ChildProcess; closed: Promise<unknown> }> = [];
const roots: string[] = [];
const childAudit: Array<{ pid: number | undefined; phase: string; closed: boolean }> = [];
afterAll(() => {
  const directory = resolve('..', '.xiaok', 'evals', 'harness2-d0'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `crash-process-audit-node-${process.versions.node}.json`), JSON.stringify({
    children: childAudit, remaining: childAudit.filter(child => !child.closed).length,
  }, null, 2));
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
    await child.closed;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});
async function crash(phase: string) {
  const root = mkdtempSync(join(tmpdir(), 'harness-crash-')); roots.push(root);
  const child = spawn(process.execPath, [resolve('tests/fixtures/harness-optimization-child.mjs'), root, phase], { stdio: ['pipe', 'pipe', 'pipe'] });
  const audit = { pid: child.pid, phase, closed: false }; childAudit.push(audit);
  const closed = once(child, 'close').then(value => { audit.closed = true; return value; }); children.push({ process: child, closed });
  writeFileSync(join(root, 'owned-child-pid.json'), JSON.stringify({ pid: child.pid, phase }));
  const value = await new Promise<Record<string, any>>((resolveReady, reject) => {
    let text = '', stderr = '';
    const timer = setTimeout(() => reject(Error('child_ready_timeout')), 10000);
    child.stderr!.on('data', data => { stderr += data; });
    child.stdout!.on('data', data => {
      text += data;
      if (text.includes('\n')) { clearTimeout(timer); try { resolveReady(JSON.parse(text.split('\n')[0])); } catch (e) { reject(e); } }
    });
    child.once('exit', () => { clearTimeout(timer); reject(Error(`child_early_exit: ${stderr}`)); });
  });
  // A second actual process cannot acquire the same live root OS lock.
  const contender = await createHarnessOptimizationRuntime({ dataRoot: root, profileId: 'profile', workspaceId: 'workspace', authorizeUser: () => false, manifestLookup: () => undefined });
  expect((await contender.api.read()).status).toBe('unavailable'); await contender.dispose();
  child.kill('SIGKILL'); await closed;
  const host = await createHarnessOptimizationRuntime({ dataRoot: root, profileId: 'profile', workspaceId: 'workspace',
    authorizeUser: () => false, manifestLookup: () => undefined, now: () => Date.UTC(2026, 9, 20, 12) });
  return { value, host };
}

it('keeps unqualified Windows/Linux factories closed', () => {
  expect(harnessOwnerPlatformQualified('win32')).toBe(false);
  expect(harnessOwnerPlatformQualified('linux')).toBe(false);
});
describe.skipIf(process.platform !== 'darwin')('real process crash and OS lock recovery', () => {
  it('resumes the same never-admitted initialization after witness-only crash', async () => {
    const { value, host } = await crash('initializing');
    try {
      expect(await host.api.read()).toMatchObject({ status: 'ready', ownerId: value.ownerId });
      expect((await host.driver.audit()).budget.reservedTokens).toBe(0);
    } finally { await host.dispose(); }
  });
  it('releases a proven not-sent preparation and never reuses its old ticket', async () => {
    const { value, host } = await crash('prepared');
    try {
      expect(await host.api.read()).toMatchObject({ status: 'ready', ownerId: value.ownerId, ownerEpoch: value.ownerEpoch + 1, recoveryGuard: true });
      expect((await host.driver.audit()).budget.reservedTokens).toBe(0);
      await expect(host.driver.send(value.ticket, () => { throw Error('sent'); })).rejects.toThrow('ticket_invalid');
    } finally { await host.dispose(); }
  });
  it('retains pre-send unknown/spent, and permits late usage without a new grant', async () => {
    const { value, host } = await crash('marked');
    try {
      expect((await host.driver.audit()).budget).toMatchObject({ reservedTokens: 2000, reservedRequests: 1 });
      expect((await host.driver.audit()).trials).toMatchObject([{ spent: 1 }]);
      await host.driver.settle({ invocationId: value.ticket.invocationId, inputTokens: 1000, outputTokens: 200 });
      expect((await host.driver.audit()).budget).toMatchObject({ reservedTokens: 0, usedTokens: 1200, usedRequests: 1 });
      expect((await host.driver.audit()).trials).toMatchObject([{ spent: 1 }]);
    } finally { await host.dispose(); }
  });
});
