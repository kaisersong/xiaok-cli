// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants } from 'node:sqlite';
import { activityFixture, barrier, nativeAuthorizer, parkedActivityFixture, serviceSite, siblingActivityFixture, spawnChunk, sqliteFault, tick, writeChunk, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { DesktopMultiAgentTurnMailbox } from '../../electron/desktop-multi-agent-mailbox.js';
import type { DesktopMultiAgentServiceOptions } from '../../electron/desktop-multi-agent-service.js';

describe.runIf(nativeAuthorizer)('R6 AF actual timers, dispatch boundaries and actor retirement', () => {
  const cleanup: Cleanup = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(['publish', 'checkpoint'] as const)('AF3 existing real %s timer read guard freezes and blocks the pending model next write', async kind => {
    const f = await parkedActivityFixture(cleanup);
    await f.service.recordActivity(f.context, { phase: 'thinking' });
    const fault = sqliteFault(f, { table: 'agents', column: 'data_json', site: kind === 'checkpoint' ? 'checkpointActivity'
      : serviceSite('private applyActivity(', 'const current = readAgent(guard)') });
    await vi.waitFor(() => expect(fault.traces).toHaveLength(1), { timeout: 6200, interval: 20 }); await tick();
    expect(f.live().frozen).toBe(kind === 'checkpoint' ? 'multi_agent_activity_persistence_failed' : 'multi_agent_activity_failed');
    expect(f.context.signal.aborted).toBe(true); expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(false);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  }, 9000);

  it.each([constants.SQLITE_READ, constants.SQLITE_INSERT])('AF3 existing finishActivity action %s fault propagates from real mailbox seal without false cleanup', async action => {
    const f = await parkedActivityFixture(cleanup);
    const fault = sqliteFault(f, { table: 'agents', action, site: 'finishActivity', column: action === constants.SQLITE_READ ? 'data_json' : undefined });
    await expect(f.context.mailbox.trySealTurn()).rejects.toThrow();
    expect(fault.traces).toHaveLength(1); expect(f.live().frozen).toBe('multi_agent_activity_persistence_failed');
    expect(f.context.signal.aborted).toBe(true); expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.resourcesReleased).toBe(false);
    f.release.release(); await f.settled(f.taskId); expect(existsSync(f.effect)).toBe(false);
  });

  it('AF3 actual child core activity existing catch freezes the root and prevents its next write', async () => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'effect.txt');
    const fault = sqliteFault(f, { table: 'agents', column: 'data_json', site: serviceSite('private captureCoreEvent(', 'this.applyActivity(') });
    f.setProgram(async function* ({ child, call }) {
      if (child) { yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk(); else if (call === 2) { await fault.hit; yield writeChunk(effect); } else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task); expect(fault.traces).toHaveLength(1);
    expect(f.live().frozen).toBe('multi_agent_persistence_failed'); expect(f.rootContext().signal.aborted).toBe(true); expect(existsSync(effect)).toBe(false);
  });

  it('AF3c actual beforeOpaqueInvocation await releases into the existing final synchronous check after sibling usage read fails', async () => {
    const f = await siblingActivityFixture(cleanup), entered = barrier(), releaseJournal = barrier(); cleanup.push(() => { releaseJournal.release(); });
    const original = DesktopMultiAgentWorktrees.prototype.beforeOpaqueInvocation;
    vi.spyOn(DesktopMultiAgentWorktrees.prototype, 'beforeOpaqueInvocation').mockImplementation(async function(this: DesktopMultiAgentWorktrees, ...args) {
      original.apply(this, args);
      if (args[1] === f.child.agentId) { entered.release(); await releaseJournal.wait; }
    });
    f.childRelease.release(); await entered.wait;
    const childEffect = join(f.root, 'child-effect.txt'); expect(existsSync(childEffect)).toBe(false);
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: 'recordUsage' });
    await expect(f.service.recordUsage(f.context, { usageId: 'journal-fault', inputTokens: 1, outputTokens: 1 })).rejects.toThrow();
    expect(fault.traces).toHaveLength(1); expect.soft(f.child.signal.aborted).toBe(true);
    releaseJournal.release(); f.release.release(); await f.settled(f.taskId);
    await vi.waitFor(() => expect(f.store.getAgent(f.child.groupId, f.child.agentId)?.executionActive).toBe(false));
    expect.soft(existsSync(childEffect)).toBe(false); expect(existsSync(f.effect)).toBe(false);
  });

  it('AF3c already dispatched real bash retains its pre-fault file and actual settlement while a later tool remains blocked', async () => {
    const f = await activityFixture(cleanup), rootEntered = barrier(), rootRelease = barrier();
    const previous = join(f.root, 'dispatched.txt'), releaseFile = join(f.root, 'release.txt'), script = join(f.root, 'bounded-owner.mjs'), effect = join(f.root, 'next-effect.txt');
    writeFileSync(script, `import{writeFileSync,existsSync}from'node:fs';writeFileSync(${JSON.stringify(previous)},'before fault');const timer=setInterval(()=>{if(existsSync(${JSON.stringify(releaseFile)})){clearInterval(timer);process.exit(0)}},10);`);
    cleanup.push(() => { writeFileSync(releaseFile, 'cleanup'); rootRelease.release(); });
    f.setProgram(async function* ({ child, call }) {
      if (child) { if (call === 1) yield { type: 'tool_use', id: 'bash-owner', name: 'bash', input: { command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, timeout: 5000 } };
        else yield { type: 'text', delta: 'child settled' }; return; }
      if (call === 1) yield spawnChunk(); else if (call === 2) { rootEntered.release(); await rootRelease.wait; yield writeChunk(effect); }
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await rootEntered.wait;
    await vi.waitFor(() => expect(existsSync(previous)).toBe(true), { timeout: 3000 });
    const child = f.childContext(); expect(f.store.getAgent(child.groupId, child.agentId)?.executionActive).toBe(true);
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: 'recordUsage' });
    await expect(f.service.recordUsage(f.rootContext(), { usageId: 'inflight-fault', inputTokens: 1, outputTokens: 1 })).rejects.toThrow();
    expect(fault.traces).toHaveLength(1); expect.soft(child.signal.aborted).toBe(true);
    expect(existsSync(previous)).toBe(true); expect(f.store.getAgent(child.groupId, child.agentId)?.resourcesReleased).toBe(false);
    writeFileSync(releaseFile, 'settle existing process'); rootRelease.release(); await f.settled(task);
    await vi.waitFor(() => expect(f.store.getAgent(child.groupId, child.agentId)?.executionActive).toBe(false));
    expect(existsSync(previous)).toBe(true); expect(existsSync(effect)).toBe(false);
  }, 9000);

  it('AF3c real provider prepare mailbox await and actual OpenAIAdapter preflight both reject after trusted usage failure', async () => {
    const f = await activityFixture(cleanup), entered = barrier(), release = barrier(); cleanup.push(() => { release.release(); });
    await f.services.saveModelConfig({ providerId: 'openai', apiKey: 'fixture-no-network' });
    f.setProgram(async function* ({ call }) { if (call === 1) yield { type: 'tool_use', id: 'list', name: 'list_agents', input: {} };
      else yield { type: 'text', delta: 'late provider response' }; });
    const original = DesktopMultiAgentTurnMailbox.prototype.drainInput;
    vi.spyOn(DesktopMultiAgentTurnMailbox.prototype, 'drainInput').mockImplementation(async function(this: DesktopMultiAgentTurnMailbox) {
      const batch = await original.call(this);
      if (f.calls.length === 1) { entered.release(); await release.wait; }
      return batch;
    });
    const task = await f.start(); await entered.wait;
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: 'recordUsage' });
    await expect(f.service.recordUsage(f.rootContext(), { usageId: 'provider-fault', inputTokens: 1, outputTokens: 1 })).rejects.toThrow();
    expect(fault.traces).toHaveLength(1);
    const call = f.calls[0]!, create = vi.spyOn(call.adapter.client.chat.completions, 'create').mockImplementation(() => { throw new Error('test-controlled SDK boundary'); });
    const stream = f.originalStream.call(call.adapter, call.messages, [], call.system, { ...call.options, signal: f.rootContext().signal });
    const outcome = await stream[Symbol.asyncIterator]().next().then(value => ({ value }), error => ({ error }));
    expect(f.rootContext().signal.aborted).toBe(true);
    expect.soft(outcome).toHaveProperty('error', f.rootContext().signal.reason);
    if ('error' in outcome) expect.soft(outcome.error).toBe(f.rootContext().signal.reason);
    expect.soft(create).not.toHaveBeenCalled();
    release.release(); await f.settled(task); expect(f.calls).toHaveLength(1);
  });

  it.each(['bindWorkingDirectory', 'getTurnContext'] as const)('AF6 real child %s closure routes its SQLite failure to the original owner', async method => {
    const f = await activityFixture(cleanup), entered = barrier(), release = barrier(); cleanup.push(() => { release.release(); });
    const options = (f.service as unknown as { options: DesktopMultiAgentServiceOptions }).options;
    const original = options.createSession; let sessionInput!: Parameters<typeof original>[0];
    vi.spyOn(options, 'createSession').mockImplementation(input => { sessionInput = input; return original(input); });
    f.setProgram(async function* ({ child, call }) { if (child) { entered.release(); await release.wait; yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk(); else { await release.wait; yield { type: 'text', delta: 'root done' }; } });
    const task = await f.start(); await entered.wait; await tick();
    const site = serviceSite('async spawn(', "this.requireActor(child.context.actor, 'agent')", method === 'bindWorkingDirectory' ? 0 : 1);
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site });
    expect(() => method === 'bindWorkingDirectory' ? sessionInput.bindWorkingDirectory!(f.root) : sessionInput.getTurnContext()).toThrow();
    expect(fault.traces).toHaveLength(1); expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.childContext().signal.aborted).toBe(true);
    release.release(); await f.settled(task);
  });

  it('AF5 an actual earlier seal command retires the actor before queued activity; the next root stays healthy', async () => {
    const f = await parkedActivityFixture(cleanup);
    const seal = f.context.mailbox.trySealTurn();
    const old = f.service.recordActivity(f.context, { phase: 'model' }).then(value => ({ value }), error => ({ error }));
    await seal; expect(await old).toHaveProperty('error'); expect(f.live().frozen).toBeUndefined();
    f.release.release(); await f.settled(f.taskId);
    const nextEntered = barrier(), nextRelease = barrier(); cleanup.push(() => { nextRelease.release(); });
    f.setProgram(async function* () { nextEntered.release(); await nextRelease.wait; yield { type: 'text', delta: 'new root done' }; });
    const nextTask = await f.start(); await nextEntered.wait;
    const next = f.contexts.filter(context => context.agentId === f.context.agentId).at(-1)!;
    expect(next.actor).not.toBe(f.context.actor); expect(next.signal.aborted).toBe(false); expect(f.live(next).frozen).toBeUndefined();
    await expect(f.service.recordActivity(f.context, { phase: 'model' })).rejects.toThrow();
    expect(next.signal.aborted).toBe(false); expect(f.live(next).frozen).toBeUndefined();
    nextRelease.release(); await f.settled(nextTask);
  });
});
