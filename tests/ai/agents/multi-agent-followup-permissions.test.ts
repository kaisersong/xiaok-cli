import { describe, expect, it, vi } from 'vitest';
import { createMultiAgentCoordinator } from '../../../src/ai/agents/multi-agent-coordinator.js';
import { createMultiAgentTools } from '../../../src/ai/tools/multi-agent.js';

const root = { requestSource: 'agent' as const, callerId: 'main' };

async function tree(active: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runs = new Map<string, string[]>();
  const coordinator = createMultiAgentCoordinator({ maxResidentAgents: 8 });
  const spawn = async (callerId: string, taskName: string) => coordinator.spawn({
    ...root, callerId, taskName, message: 'initial',
    createSession: async (identity) => ({
      run: async (message) => {
        const requests = runs.get(identity.id) ?? [];
        requests.push(message); runs.set(identity.id, requests);
        if (active && requests.length === 1) await gate;
        return 'done';
      }, dispose: async () => {},
    }),
  });
  const parent = await spawn('main', 'parent');
  const sibling = await spawn('main', 'sibling');
  const child = await spawn(parent.id, 'child');
  const cousin = await spawn(sibling.id, 'cousin');
  const grandchild = await spawn(child.id, 'grandchild');
  await vi.waitFor(() => {
    const records = coordinator.listAgents(root).filter((record) => record.id !== 'main');
    expect(records.every((record) => record.status === (active ? 'running' : 'completed'))).toBe(true);
    if (!active) expect(records.every((record) => !record.executionActive)).toBe(true);
  });
  return { coordinator, parent, sibling, child, cousin, grandchild, runs, release,
    cleanup: async () => { release(); await coordinator.dispose(); },
  };
}

describe('followup control-plane ownership', () => {
  it.each([false, true])('rejects self, ancestor and other branches without enqueuing work (active=%s)', async (active) => {
    const t = await tree(active);
    try {
      for (const target of [t.child, t.parent, t.sibling, t.cousin]) {
        for (const alias of [target.id, target.canonicalName]) {
          const before = t.coordinator.listAgents(root);
          expect(() => t.coordinator.followupTask({ ...root, callerId: t.child.id, target: alias, message: 'forbidden' }))
            .toThrow('not permitted');
          expect(t.coordinator.listAgents(root)).toEqual(before);
        }
      }
      for (const alias of ['main', '/root']) {
        expect(() => t.coordinator.followupTask({ ...root, callerId: t.child.id, target: alias, message: 'forbidden' })).toThrow('root');
      }
      t.release();
      await vi.waitFor(() => expect(t.coordinator.listAgents(root).every((record) => !record.executionActive)).toBe(true));
      for (const target of [t.child, t.parent, t.sibling, t.cousin, t.grandchild]) expect(t.runs.get(target.id)).toEqual(['initial']);
    } finally { await t.cleanup(); }
  });

  it('allows strict descendants, preserves cross-tree communication, and keeps host-source rules', async () => {
    const t = await tree(false);
    try {
      for (const [callerId, target] of [['main', t.parent.id], [t.parent.id, t.child.id], [t.child.id, t.grandchild.id], ['main', t.grandchild.canonicalName]]) {
        expect(t.coordinator.followupTask({ ...root, callerId, target, message: 'allowed' })).toEqual({ queued: true });
      }
      t.coordinator.sendMessage({ ...root, callerId: t.child.id, target: 'main', message: 'child report' });
      const report = await t.coordinator.waitForUpdate({ ...root, targets: [t.child.id], timeoutMs: 1000 });
      expect(report.messages).toContainEqual(expect.objectContaining({ text: 'child report' }));
      expect(t.coordinator.followupTask({ requestSource: 'user', callerId: t.child.id, target: t.sibling.id, message: 'host allowed' })).toEqual({ queued: true });
      expect(() => t.coordinator.followupTask({ ...root, requestSource: 'scheduler' as never, target: t.child.id, message: 'no' })).toThrow('not permitted');
      await vi.waitFor(() => expect(t.coordinator.listAgents(root).every((record) => !record.executionActive)).toBe(true));
      expect(t.runs.get(t.grandchild.id)).toEqual(['initial', 'allowed', 'allowed']);
    } finally { await t.cleanup(); }
  });

  it('binds the real tool to its caller and refuses forged source/caller fields', async () => {
    const t = await tree(false);
    try {
      const tools = createMultiAgentTools({ coordinator: t.coordinator, callerId: t.child.id, agents: [],
        createSession: async () => ({ run: async () => 'unused', dispose: async () => {} }),
      });
      const followup = tools.find((tool) => tool.definition.name === 'followup_task')!;
      await expect(followup.execute({ target: t.sibling.id, message: 'forbidden', callerId: 'main', requestSource: 'user' }))
        .rejects.toThrow('not permitted');
      await expect(followup.execute({ target: t.grandchild.id, message: 'allowed' })).resolves.toContain('queued');
      await vi.waitFor(() => expect(t.runs.get(t.grandchild.id)).toEqual(['initial', 'allowed']));
      expect(t.runs.get(t.sibling.id)).toEqual(['initial']);
    } finally { await t.cleanup(); }
  });
});
