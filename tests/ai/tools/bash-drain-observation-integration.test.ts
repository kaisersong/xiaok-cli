import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservationTerminalFacts } from '../../../src/runtime/sol-pi/collector-port.js';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';

vi.mock('child_process', async original => ({ ...await original<typeof import('child_process')>(), spawn: vi.fn() }));
const { spawn } = await import('child_process');
const { bashTool } = await import('../../../src/ai/tools/bash.js');
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const actualPlatform = process.platform;
const cleanup: Array<() => void> = [];
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
});
const tick = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function fixture(timeoutMs = 1000) {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() });
  const killer = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReset().mockReturnValueOnce(child as never).mockReturnValue(killer as never);
  const controller = new AbortController(), append = vi.fn(), finalize = vi.fn();
  let settled = false;
  const pending = bashTool.execute({ command: 'echo original', timeout_ms: timeoutMs }, { signal: controller.signal,
    observationCollector: { begin: () => ({ append, finalize }) } } as never);
  void pending.then(() => { settled = true; }, () => { settled = true; });
  cleanup.push(() => { child.emit('close', 0); child.stdout.destroy(); child.stderr.destroy(); });
  await new Promise<void>(resolve => setImmediate(resolve));
  return { child, killer, controller, append, finalize, pending, settled: () => settled };
}
async function inheritedFacts() {
  const f = await fixture();
  try {
    f.child.stdout.write('KNOWN_'); f.child.emit('exit', 0, null);
    await tick(250); expect(f.settled()).toBe(true);
    const result = await f.pending;
    expect(result).toContain('后代仍持有输出管道');
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(['cmd']);
    expect(f.finalize).toHaveBeenCalledOnce();
    return { facts: f.finalize.mock.calls[0][0] as ObservationTerminalFacts, chunks: f.append.mock.calls.map(([text]) => text).join('') };
  } finally { f.child.emit('close', 0); await f.pending.catch(() => {}); }
}

describe('Windows shell exit and observation terminal facts integration', () => {
  it('known shell exit bounds inherited pipes and records interrupted output rather than complete capture', async () => {
    const { facts, chunks } = await inheritedFacts();
    expect(chunks).toBe('KNOWN_');
    expect(facts).toEqual({ executionState: 'terminal', outcome: 'success', incompleteReason: 'interrupted' });
  });

  it('cancellation after actual exit never kills descendants and preserves original cancellation facts', async () => {
    const f = await fixture(), reason = new DOMException('original stop A', 'AbortError');
    try {
      f.child.emit('exit', 0, null); f.controller.abort(reason);
      await expect(f.pending).rejects.toBe(reason);
      expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(['cmd']);
      expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ executionState: 'terminal', outcome: 'cancelled', incompleteReason: 'cancelled' });
    } finally { f.child.emit('close', 0); await f.pending.catch(() => {}); }
  });

  it('normal close retains complete terminal facts and independently decodes both UTF8 streams', async () => {
    const f = await fixture();
    try {
      f.child.stdout.write(Buffer.from([0xe4])); f.child.stderr.write(Buffer.from([0xe5]));
      f.child.stdout.write(Buffer.from([0xbd, 0xa0])); f.child.stderr.write(Buffer.from([0xa5, 0xbd]));
      f.child.emit('exit', 0, null); f.child.emit('close', 0, null); await f.pending;
      const chunks = f.append.mock.calls.map(([text]) => text).join('');
      expect(chunks).toContain('你'); expect(chunks).toContain('好'); expect(chunks).not.toContain('\uFFFD');
      expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ executionState: 'terminal', outcome: 'success' });
    } finally { f.child.emit('close', 0); await f.pending.catch(() => {}); }
  });

  it('timeout and a failed Windows taskkill remain pending until actual child close', async () => {
    const f = await fixture(10);
    try {
      await tick(30); f.killer.emit('error', Object.assign(Error('kill denied'), { code: 'EPERM' }));
      expect(f.settled()).toBe(false); expect(f.finalize).not.toHaveBeenCalled();
      f.child.emit('close', null, 'SIGTERM'); expect(await f.pending).toContain('超时');
      expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ executionState: 'terminal', outcome: 'timeout', incompleteReason: 'timeout' });
    } finally { f.child.emit('close', 0); await f.pending.catch(() => {}); }
  });

  it('an unconfirmed child error never fabricates a terminal outcome', async () => {
    const f = await fixture();
    try {
      f.child.emit('error', Error('original spawn error B')); expect(await f.pending).toContain('original spawn error B');
      expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ executionState: 'termination_pending', incompleteReason: 'termination_unconfirmed' });
    } finally { f.child.emit('close', 0); await f.pending.catch(() => {}); }
  });

  it('actual Bash facts are accepted by the durable service and cannot archive or disclose the interrupted prefix', async () => {
    const { facts, chunks } = await inheritedFacts();
    Object.defineProperty(process, 'platform', platformDescriptor);
    const root = mkdtempSync(join(tmpdir(), 'xiaok-bash-facts-service-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const redact = vi.fn((text: string) => text);
    if (actualPlatform === 'win32') {
      expect(() => createObservationService({ profileRoot: root, profileId: 'profile', redactor: { version: 'test-v1', redact } })).toThrow('directory sync durability unsupported on Windows');
      return;
    }
    const service = createObservationService({ profileRoot: root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact } });
    cleanup.push(() => service.dispose());
    const claims = { sessionId: 'session', ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, requestSource: 'agent' as const, surface: 'ordinary-owner' as const };
    const caller = service.bindCaller(claims), user = service.bindCaller({ ...claims, requestSource: 'user' });
    const destination = { provider: 'test-provider', model: 'test-model', url: 'https://example.test/v1/messages' };
    service.setArchivePolicy({ caller: user, requestSource: 'user', policy: { version: 1, id: 'policy', revision: 1, scopeId: 'scope', sourceAdapterId: 'test-source', sourceDescriptors: ['source'], expiresAt: 10000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
    const capture = service.begin({ caller, requestSource: 'agent', invocationId: 'original-bash', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    service.append({ caller, requestSource: 'agent', capture, text: chunks });
    const ref = service.finalize({ caller, requestSource: 'agent', capture, ...facts });
    expect(ref).toMatchObject({ executionState: 'terminal', outcome: 'success', complete: false, incompleteReason: 'interrupted', byteLength: 0, contentHash: '' });
    expect(redact).not.toHaveBeenCalled(); expect(readdirSync(join(root, 'observations'))).not.toContain(ref.id + '.body');
    expect(() => service.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
});
