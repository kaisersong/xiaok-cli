// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';
import { encodeMultiAgentRow, truncateMultiAgentText } from '../../electron/desktop-multi-agent-store.js';
import { desktopSubAgentSummary } from '../../electron/desktop-subagent-presentation.js';
import type { DesktopAgentSnapshot, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types.js';

type Pending = { approvalId: string; agentId: string; turnId: string; canDecide: boolean };
type ApprovalSnapshot = MultiAgentGroupSnapshot & { pendingApprovals?: Pending[]; pendingApprovalCount?: number };
const bytes = (value: unknown) => Buffer.byteLength(encodeMultiAgentRow(value));

describe('BDD AP6: real store/sender pending metadata fits the existing wire budget', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('Given nine real default-mode waiters and a formerly legal near-limit snapshot, Then initial reply trims only its old agent page, live approval events stay bounded, and zero pending restores the ordinary page', async () => {
    const f = await authorizationFixture(cleanup), released = deferred(); cleanup.push(() => released.resolve());
    const threadId = '\u0001'.repeat(256), subscriptionId = '\u0002'.repeat(256);
    let rootRequests = 0;
    const childRequests = new Map<string, number>();
    const effects: string[] = [];
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (_messages, _tools, system) {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (system?.includes('Assigned Desktop agent:')) {
        const key = system; const count = (childRequests.get(key) ?? 0) + 1; childRequests.set(key, count);
        if (count === 1) {
          const effect = join(f.root, `child-${childRequests.size}.txt`); effects.push(effect);
          yield { type: 'tool_use', id: `child-write-${childRequests.size}`, name: 'write', input: { file_path: effect, content: 'only with separate approval' } };
        } else { await released.promise; yield { type: 'text', delta: 'Child ended.' }; }
        return;
      }
      const count = ++rootRequests;
      if (count <= 8) yield { type: 'tool_use', id: `spawn-${count}`, name: 'spawn_agent', input: { task_name: `child_${count}`, message: 'Request one file write.', fork_context: false } };
      else if (count === 9) {
        const effect = join(f.root, 'root.txt'); effects.push(effect);
        yield { type: 'tool_use', id: 'root-write', name: 'write', input: { file_path: effect, content: 'only with root approval' } };
      } else { await released.promise; yield { type: 'text', delta: 'Root ended.' }; }
    });
    await f.services.createTask({ prompt: 'Delegate eight bounded tasks, then request one root write.', permissionMode: 'default', materials: [], context: { threadId } });
    await vi.waitFor(async () => expect(rootRequests >= 10 || (await f.invoke<ApprovalSnapshot>('getMultiAgentSnapshot', { threadId })).pendingApprovals?.length === 9).toBe(true));
    const initial = await f.invoke<ApprovalSnapshot>('getMultiAgentSnapshot', { threadId });
    expect(initial.pendingApprovals, 'production must first own nine independent real pending approvals, not fake them in the snapshot fixture').toHaveLength(9);
    expect(initial.pendingApprovalCount).toBe(9);
    const groupId = initial.group!.groupId, rootId = `root_${groupId}`;
    const originals = f.store.allAgents(groupId);
    expect(originals.filter(agent => agent.parentId !== null)).toHaveLength(8);
    cleanup.push(() => { for (const agent of originals) f.store.putAgent(groupId, agent, true); });

    // These are durable presentation fixtures, not a second approval map or a
    // copied paginator. Real waiter identities/lifetimes remain untouched.
    const names = Array.from({ length: 32 }, (_, n) => `mcp__documents__read_document_section_${String(n).padStart(2, '0')}_${'field'.repeat(4)}`.slice(0, 60));
    function fillStats(id: string, ceiling: number) {
      let row = f.store.getAgent(groupId, id)!;
      outer: for (const original of Object.keys(row.toolCounts!)) for (let offset = 59; offset >= 40; offset--) {
        const prior = Object.keys(row.toolCounts!).find(name => name.slice(0, 40) === original.slice(0, 40))!;
        const next = prior.slice(0, offset) + '资' + prior.slice(offset + 1);
        expect(desktopSubAgentSummary(next, 60)).toBe(next);
        const { [prior]: count, ...rest } = row.toolCounts!;
        const candidate = { ...row, toolCounts: { ...rest, [next]: count } };
        if (bytes(candidate) > ceiling) break outer;
        row = f.store.putAgent(groupId, candidate, true);
      }
      expect(bytes(row)).toBeLessThanOrEqual(4096);
    }
    for (const agent of originals.filter(row => row.parentId !== null)) {
      f.store.putAgent(groupId, { ...agent, taskSummary: desktopSubAgentSummary('检查资料来源和权限边界。'.repeat(30)),
        toolsCompleted: 32, toolsFailed: 0, toolCounts: Object.fromEntries(names.map(name => [name, 1])), otherToolCount: 0 }, true);
      fillStats(agent.id, 4096);
    }
    for (let n = 0; n < 48; n++) {
      const id = randomUUID(), text = '已检查资料来源和权限边界。'.repeat(30);
      f.store.putAgent(groupId, { id, parentId: rootId, taskName: `prior_${n}`, canonicalName: `/root/prior_${n}`, depth: 1,
        status: 'closed', turn: 1, turnId: randomUUID(), resourcesReleased: true, activationState: 'settled', createdAt: 1 + n }, true);
      const content = f.store.putContent(groupId, id, text);
      f.store.putAgent(groupId, { ...f.store.getAgent(groupId, id)!, sourceTaskId: `task_${randomUUID()}`, resultContentId: content.contentId,
        taskSummary: desktopSubAgentSummary('检查资料来源和权限边界。'.repeat(30)), resultSummary: desktopSubAgentSummary(text), lastResult: truncateMultiAgentText(text, 1024).text,
        startedAt: 1, endedAt: 2, lastActivityAt: 2, activityRevision: 12, usage: { inputTokens: 64000, outputTokens: 16000 },
        toolCounts: Object.fromEntries(names.slice(0, 12).map(name => [name, 1])), toolsCompleted: 12, toolsFailed: 0,
        otherToolCount: 0, toolStatisticsComplete: true }, true);
      fillStats(id, 4048);
    }
    const ordinaryPage = f.store.listAgents(groupId, undefined, 50, 24 * 1024);
    const reply = await f.invoke<{ subscriptionId: string; snapshot: ApprovalSnapshot }>('subscribeMultiAgents', { threadId, subscriptionId });
    const untrimmed = { ...reply.snapshot, agents: ordinaryPage.items, nextAgentCursor: ordinaryPage.nextCursor };
    const { pendingApprovals: _pending, pendingApprovalCount: _count, ...beforeApprovalFields } = untrimmed;
    expect(bytes({ subscriptionId, snapshot: beforeApprovalFields }), 'the fixture must not mistake a previously oversized snapshot for the new approval regression').toBeLessThanOrEqual(65536);
    expect(bytes({ subscriptionId, snapshot: untrimmed }), 'the legal pending fields must really cross the old wire limit').toBeGreaterThan(65536);
    expect(bytes(reply)).toBeLessThanOrEqual(65536);
    expect(reply.snapshot.pendingApprovals).toHaveLength(9);
    expect(reply.snapshot.residentAgents).toHaveLength(8);
    expect(reply.snapshot.root?.id).toBe(rootId);
    expect(reply.snapshot.agents.length).toBeLessThan(ordinaryPage.items.length);
    expect(reply.snapshot.nextAgentCursor).not.toBeNull();
    const seen = new Set(reply.snapshot.agents.map(agent => agent.id));
    const cursors = new Set<string>();
    let cursor = reply.snapshot.nextAgentCursor;
    while (cursor) {
      expect(cursors.has(cursor)).toBe(false); cursors.add(cursor);
      const page = await f.invoke<{ items: DesktopAgentSnapshot[]; nextCursor: string | null }>('listMultiAgents', { threadId, groupId, cursor });
      for (const agent of page.items) { expect(seen.has(agent.id)).toBe(false); seen.add(agent.id); }
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(f.store.allAgents(groupId).length);
    expect(effects.every(path => !existsSync(path))).toBe(true);

    // Restore normal active rows before settlement: this test is about wire
    // projection, not enlarging subsequent status-event control records.
    for (const agent of originals) f.store.putAgent(groupId, agent, true);
    const beforeEvents = f.sent.length;
    for (const approval of initial.pendingApprovals!) await f.invoke('decideMultiAgentApproval', { threadId, groupId,
      approvalId: approval.approvalId, operationId: `deny-${approval.approvalId}`, decision: 'deny' });
    expect(f.sent.slice(beforeEvents).some(item => (item.data as any)?.envelope?.kind === 'approval')).toBe(true);
    for (const item of f.sent.slice(beforeEvents)) expect(bytes(item.data)).toBeLessThanOrEqual(65536);
    const empty = await f.invoke<ApprovalSnapshot>('getMultiAgentSnapshot', { threadId });
    expect(empty.pendingApprovalCount).toBe(0);
    expect(empty.agents.map(agent => agent.id)).toEqual(f.store.listAgents(groupId, undefined, 50, 24 * 1024).items.map(agent => agent.id));
    expect(effects.every(path => !existsSync(path))).toBe(true);
    released.resolve();
  });
});
