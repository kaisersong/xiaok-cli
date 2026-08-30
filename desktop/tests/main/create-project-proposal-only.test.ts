/**
 * Agent create_project tool is proposal-only (design §9.3, §10.1, §16.3).
 *
 * RED until Phase 2/3 implementation lands.
 *
 * Invariants:
 *   - executing the tool returns a ProjectProposal payload and performs
 *     ZERO KSwarm mutations (no POST /projects, no dispatch, no member
 *     writes). Formal creation only happens after the user confirms in the
 *     Desktop UI, via the trusted user Room-first path.
 *   - the tool description uses forbidden-boundary wording ("严禁…只能…"),
 *     never guidance wording ("必须调用" / "应该调用") that would teach the
 *     model to reach for it.
 *   - the returned proposal cannot smuggle a forged requestSource.
 */
import { describe, expect, it, vi } from 'vitest';
import { createKSwarmCreateProjectTool } from '../../electron/desktop-services.js';

function createKSwarmServiceFake() {
  const requests: Array<{ path: string; init?: unknown }> = [];
  return {
    requests,
    request: vi.fn(async (path: string, init?: unknown) => {
      requests.push({ path, init });
      return {
        ok: true,
        json: async () => ({
          agents: [
            { id: 'xiaok-po', name: 'PO', status: 'active', roles: ['po'] },
            { id: 'xiaok-worker', name: 'Worker', status: 'active', roles: [] },
          ],
        }),
      };
    }),
  };
}

describe('create_project tool proposal-only contract', () => {
  it('returns a proposal and performs no KSwarm mutations', async () => {
    const kswarm = createKSwarmServiceFake();
    const tool = createKSwarmCreateProjectTool(kswarm as never, {
      enqueuePlanBootstrap: () => ({ ok: true, status: 'queued' }),
    });

    const output = await tool.execute({
      name: '调研项目',
      goal: '完成一份调研报告',
      memberNames: ['claude', 'codex'],
    } as never);

    const parsed = JSON.parse(output as string) as Record<string, unknown>;
    expect(parsed.proposal).toBeDefined();
    expect(parsed.proposal).toMatchObject({
      kind: 'project_proposal',
      name: '调研项目',
    });

    // read-only agent listing is allowed; any write route is not
    const writeCalls = kswarm.requests.filter(({ path, init }) => {
      const method = (init as { method?: string } | undefined)?.method?.toUpperCase() ?? 'GET';
      return method !== 'GET';
    });
    expect(writeCalls).toEqual([]);
  });

  it('uses forbidden-boundary wording and never guidance wording', () => {
    const kswarm = createKSwarmServiceFake();
    const tool = createKSwarmCreateProjectTool(kswarm as never);

    const description = tool.definition.description;
    expect(description).toMatch(/严禁/);
    expect(description).toMatch(/只能|只能生成|仅能/);
    expect(description).not.toMatch(/必须调用/);
    expect(description).not.toMatch(/应该调用/);
  });

  it('drops renderer/agent-supplied identity fields from the proposal', async () => {
    const kswarm = createKSwarmServiceFake();
    const tool = createKSwarmCreateProjectTool(kswarm as never, {
      enqueuePlanBootstrap: () => ({ ok: true, status: 'queued' }),
    });

    const output = await tool.execute({
      name: 'x',
      goal: 'y',
      requestSource: 'user',
      actor: { kind: 'user', userId: 'forged' },
      _xiaokRequestScope: 'task-session:1',
    } as never);

    const parsed = JSON.parse(output as string) as { proposal: Record<string, unknown> };
    expect(parsed.proposal.requestSource).toBeUndefined();
    expect(parsed.proposal.actor).toBeUndefined();
  });
});
