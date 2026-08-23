import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ControlledStdioClientTransport,
  type ForceKillGuard,
} from '../../../src/platform/mcp/controlled-stdio-transport.js';

const FAST_BUDGET = { stdinGraceMs: 150, termGraceMs: 150, killGraceMs: 400 };
const allowGuard: ForceKillGuard = { canForceKill: async () => true };
const refuseGuard: ForceKillGuard = { canForceKill: async () => false };

const scratch = mkdtempSync(join(tmpdir(), 'controlled-stdio-'));
const survivors: number[] = [];

/** Echoes one JSON line back and exits on stdin end. */
const politeServer = join(scratch, 'polite.mjs');
writeFileSync(politeServer, `
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim()) process.stdout.write(JSON.stringify({ echo: JSON.parse(line) }) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`);

/** Ignores stdin end and SIGTERM, and holds a descendant. */
const stubbornServer = join(scratch, 'stubborn.mjs');
writeFileSync(stubbornServer, `
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
const kid = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: false });
process.stdout.write(JSON.stringify({ ready: true, descendant: kid.pid }) + '\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`);

function makeTransport(script: string, overrides: Partial<Parameters<typeof ControlledStdioClientTransport.prototype.constructor>[0]> = {}) {
  return new ControlledStdioClientTransport({
    command: process.execPath,
    args: [script],
    finalEnv: { PATH: '/usr/bin:/bin' },
    resourceId: `res-${Math.random().toString(36).slice(2)}`,
    forceKillGuard: allowGuard,
    closeBudget: FAST_BUDGET,
    ...overrides,
  } as never);
}

afterAll(() => {
  for (const pid of survivors) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});

describe('ControlledStdioClientTransport env ownership (design §3.4, §4.4)', () => {
  it('passes finalEnv verbatim and never merges process.env', async () => {
    process.env.XIAOK_CONTROLLED_CANARY = 'leaked';
    const dumpEnv = join(scratch, 'dump-env.mjs');
    writeFileSync(dumpEnv, `
process.stdout.write(JSON.stringify({ keys: Object.keys(process.env).sort() }) + '\\n');
process.stdin.on('end', () => process.exit(0));
`);
    const transport = makeTransport(dumpEnv);
    const seen = new Promise<string[]>((resolve) => {
      transport.onmessage = (m) => resolve((m as { keys: string[] }).keys);
    });

    await transport.start();
    const keys = await seen;
    await transport.close();

    expect(keys).not.toContain('XIAOK_CONTROLLED_CANARY');
    // Only the host-provided key plus OS-injected keys frozen by the design.
    const allowed = new Set(['PATH', '__CF_USER_TEXT_ENCODING', 'LC_CTYPE']);
    expect(keys.filter((k) => !allowed.has(k))).toEqual([]);
    delete process.env.XIAOK_CONTROLLED_CANARY;
  });
});

describe('ControlledStdioClientTransport close state machine', () => {
  it('closes on stdin end and reports an expected exit exactly once', async () => {
    const transport = makeTransport(politeServer);
    await transport.start();
    const pid = transport.getChildPid();
    expect(pid).toBeGreaterThan(0);

    await transport.close();
    const outcome = await transport.closed;

    expect(outcome.expected).toBe(true);
    expect(transport.cleanupStatus).toEqual({ ok: true, escalation: 'stdin' });
  });

  it('shares one close promise across repeated entry points', async () => {
    const transport = makeTransport(politeServer);
    await transport.start();
    let closeEvents = 0;
    transport.onclose = () => { closeEvents += 1; };

    await Promise.all([transport.close(), transport.close(), transport.close()]);
    await transport.close();

    expect(closeEvents).toBe(1);
  });

  it('escalates stdin → SIGTERM → SIGKILL for a child that ignores both', async () => {
    const transport = makeTransport(stubbornServer);
    const ready = new Promise<number>((resolve) => {
      transport.onmessage = (m) => resolve((m as { descendant: number }).descendant);
    });
    await transport.start();
    const descendant = await ready;
    survivors.push(descendant);

    await transport.close();

    expect(transport.cleanupStatus).toEqual({ ok: true, escalation: 'sigkill' });
    const outcome = await transport.closed;
    expect(outcome.expected).toBe(true);
    expect(outcome.signal).toBe('SIGKILL');
  }, 15_000);

  it('never signals when the guard refuses, and leaves the child alive with a typed failure', async () => {
    const transport = makeTransport(stubbornServer, { forceKillGuard: refuseGuard });
    const ready = new Promise<number>((resolve) => {
      transport.onmessage = (m) => resolve((m as { descendant: number }).descendant);
    });
    await transport.start();
    const descendant = await ready;
    const pid = transport.getChildPid()!;
    survivors.push(descendant, pid);

    await transport.close();

    expect(transport.cleanupStatus).toMatchObject({ ok: false, reason: 'guard_refused' });
    // Wait well past the SDK's historical 4s delayed-kill window: no background
    // kill may fire, so the parent must still be alive.
    await new Promise((r) => setTimeout(r, 4_500));
    expect(() => process.kill(pid, 0)).not.toThrow();
  }, 20_000);

  it('surfaces a guard that throws as a typed failure without signalling', async () => {
    const throwingGuard: ForceKillGuard = { canForceKill: async () => { throw new Error('guard exploded'); } };
    const transport = makeTransport(stubbornServer, { forceKillGuard: throwingGuard });
    const ready = new Promise<number>((resolve) => {
      transport.onmessage = (m) => resolve((m as { descendant: number }).descendant);
    });
    await transport.start();
    const descendant = await ready;
    const pid = transport.getChildPid()!;
    survivors.push(descendant, pid);

    await transport.close();

    expect(transport.cleanupStatus).toMatchObject({ ok: false, reason: 'guard_threw' });
  }, 15_000);
});

describe('ControlledStdioClientTransport startup abort ownership (design §5.5, R51-02)', () => {
  it('refuses to spawn when the startup signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = makeTransport(politeServer, { startupSignal: controller.signal });

    await expect(transport.start()).rejects.toThrow(/startup aborted/);
    expect(transport.getChildPid()).toBeNull();
  });

  it('closes the spawned child when the startup signal fires after spawn', async () => {
    const controller = new AbortController();
    const transport = makeTransport(stubbornServer, { startupSignal: controller.signal });
    await transport.start();
    const pid = transport.getChildPid()!;
    survivors.push(pid);

    controller.abort();
    await transport.close();
    const outcome = await transport.closed;

    expect(outcome.expected).toBe(true);
    expect(transport.cleanupStatus?.ok).toBe(true);
  }, 15_000);
});

describe('ControlledStdioClientTransport unexpected exit signal', () => {
  it('classifies a self-exit before host close as unexpected', async () => {
    const suicidal = join(scratch, 'suicidal.mjs');
    writeFileSync(suicidal, 'setTimeout(() => process.exit(7), 30);\n');
    const transport = makeTransport(suicidal);
    await transport.start();

    const outcome = await transport.closed;

    expect(outcome).toMatchObject({ expected: false, exitCode: 7 });
  });
});
