// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { activityFixture, barrier, nativeAuthorizer, serviceSite, spawnChunk, sqliteFault, tick, writeChunk, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';

describe.runIf(nativeAuthorizer)('R6 AF real factory activity and sibling SQLite failures', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([
    ['AF1 first group', 'groups', 'recordActivity', 0],
    ['AF1 queued group', 'groups', serviceSite('async recordActivity(', "this.requireActor(context.actor", 1), 0],
    ['AF1 queued apply agent', 'agents', 'applyActivity', 0],
  ] as const)('%s read failure freezes the owner before its next actual scoped write', async (_label, table, site, occurrence) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'next-effect.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, occurrence });
    f.setProgram(async function* ({ call }) { if (call === 1) { await tick(); yield writeChunk(effect); } else yield { type: 'text', delta: 'done' }; });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect(f.store.requireGroup(f.rootContext().groupId)).toBeTruthy();
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.rootContext().signal.aborted).toBe(true);
    expect.soft(existsSync(effect)).toBe(false); expect(f.calls.filter(call => !call.child).length).toBeLessThanOrEqual(1);
  });

  it.each([
    ['AF2 first group', 'groups', 'recordRunStarted', 0, false],
    ['AF2 queued group', 'groups', serviceSite('async recordRunStarted(', 'this.requireActor(context.actor', 1), 0, false],
    ['AF2 receipt', 'operations', serviceSite('async recordRunStarted(', 'store.getOperation'), 0, false],
    ['AF2 transaction existing guard', 'agents', serviceSite('async recordRunStarted(', 'const previous = this.requireAgent'), 0, true],
  ] as const)('%s failure blocks child model entry and the parent next write', async (_label, table, site, occurrence, existing) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'root-after-child-fault.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, occurrence });
    f.setProgram(async function* ({ child, call }) {
      if (child) { yield writeChunk(join(f.root, 'forbidden-child.txt')); return; }
      if (call === 1) yield spawnChunk();
      else if (call === 2) { await fault.hit; await tick(); yield writeChunk(effect); }
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect.soft(f.calls.filter(call => call.child)).toHaveLength(0);
    expect.soft(f.live().frozen).toBe(existing ? 'multi_agent_presentation_persistence_failed' : 'multi_agent_persistence_failed');
    expect.soft(f.rootContext().signal.aborted).toBe(true); expect.soft(existsSync(effect)).toBe(false);
    expect(existsSync(join(f.root, 'forbidden-child.txt'))).toBe(false);
  });

  it.each(['recordRuntimeEvent', 'recordUsage'] as const)('AF2b root awaited %s read failure must abort its already running child', async method => {
    const f = await activityFixture(cleanup), entered = barrier(), release = barrier(), effect = join(f.root, 'child-after-root-fault.txt');
    cleanup.push(() => { release.release(); });
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: method });
    f.setProgram(async function* ({ child, call }) {
      if (child) { if (call === 1) { entered.release(); await release.wait; yield writeChunk(effect); } else yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk();
      else { await entered.wait; if (method === 'recordUsage') yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        else yield { type: 'text', delta: 'root output' }; }
    });
    const task = await f.start(); await fault.hit; await tick();
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.childContext().signal.aborted).toBe(true);
    release.release(); await f.settled(task);
    await vi.waitFor(() => expect(f.store.getAgent(f.childContext().groupId, f.childContext().agentId)?.executionActive).toBe(false));
    expect(fault.traces).toHaveLength(1); expect(existsSync(effect)).toBe(false);
  });

  it.each(['groups', 'operations'] as const)('AF2b child tool_finished %s read failure preserves its previous file but blocks parent next dispatch', async table => {
    const f = await activityFixture(cleanup), previous = join(f.root, 'already-dispatched.txt'), effect = join(f.root, 'parent-after-tool-fault.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site: table === 'groups' ? 'recordToolFinished' : serviceSite('async recordToolFinished(', 'const existing = this.persistenceIO') });
    f.setProgram(async function* ({ child, call }) {
      if (child) { if (call === 1) yield writeChunk(previous); else yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk();
      else if (call === 2) { await fault.hit; await tick(); yield writeChunk(effect); }
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect(existsSync(previous)).toBe(true);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.rootContext().signal.aborted).toBe(true);
    expect(existsSync(effect)).toBe(false);
  });

  it.each([
    ['AF6 list first group', 'groups', 'DesktopMultiAgentService.list', 'list_agents'],
    ['AF6 list page', 'agents', 'DesktopMultiAgentService.list', 'list_agents'],
    ['AF6 send receipt', 'operations', 'DesktopMultiAgentService.mutate', 'send_message'],
    ['AF6 scoped invocation', 'groups', 'assertInvocation', 'write'],
  ] as const)('%s failure blocks the actual provider next tool dispatch', async (_label, table, site, tool) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'next-effect.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, extra: () => f.calls.length > 0 });
    f.setProgram(async function* ({ call }) {
      if (call === 1) {
        if (tool === 'write') yield writeChunk(join(f.root, 'first-effect.txt'), 'first');
        else yield { type: 'tool_use', id: 'control', name: tool, input: tool === 'send_message' ? { target: 'main', message: 'bounded' } : {} };
      } else if (call === 2) yield writeChunk(effect);
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed');
    expect.soft(f.rootContext().signal.aborted).toBe(true); expect(existsSync(effect)).toBe(false);
  });
});
