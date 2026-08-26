import { describe, expect, it } from 'vitest';
import {
  GoalService,
  InMemoryGoalStore,
  type GoalMutationContext,
} from '../../../src/runtime/goal/index.js';

const owner = {
  assertOwned(sessionId: string, instanceId: string) {
    if (sessionId !== 'sess_1' || instanceId !== 'inst_1') {
      throw new Error('not owner');
    }
  },
};

function userContext(expectedRevision: number | null): GoalMutationContext {
  return {
    sessionId: 'sess_1',
    instanceId: 'inst_1',
    requestSource: 'user',
    expectedRevision,
  };
}

describe('GoalService', () => {
  it('enforces owner, requestSource and stale revision through the public service', async () => {
    const store = new InMemoryGoalStore();
    const service = new GoalService({ store, ownership: owner, now: () => 100 });
    const created = await service.create(userContext(null), {
      objective: '完成任务',
      expectedEvidenceKinds: ['answer'],
      turnLimit: 5,
    });

    await expect(service.pause({ ...userContext(created.revision), instanceId: 'other' }, 'x'))
      .rejects.toThrow(/owner/);
    await expect(service.pause({ ...userContext(created.revision), requestSource: 'agent' }, 'x'))
      .rejects.toThrow(/agent/i);

    const paused = await service.pause(userContext(created.revision), 'user');
    await expect(service.resume(userContext(created.revision))).rejects.toThrow(/stale/i);
    expect(paused.status).toBe('paused');
  });

  it('commits state, event, turn and evidence as one batch', async () => {
    const store = new InMemoryGoalStore();
    const service = new GoalService({ store, ownership: owner, now: () => 100 });
    const created = await service.create(userContext(null), {
      objective: '写文件并验证',
      expectedEvidenceKinds: ['file_artifact'],
      turnLimit: 5,
    });

    store.failNextCommit = true;
    await expect(service.recordTurn(
      { ...userContext(created.revision), requestSource: 'runtime' },
      {
        turnId: 'turn_1',
        tokensUsed: 12,
        activeWallClockMs: 30,
        evidence: [{
          id: 'ev_1',
          ownerKind: 'goal',
          ownerId: created.goalId,
          kind: 'file_artifact',
          status: 'validated',
          summary: 'a.txt',
          recordedAt: 100,
        }],
      },
    )).rejects.toThrow(/injected/);

    const document = await store.load('sess_1');
    expect(document?.state.revision).toBe(created.revision);
    expect(document?.turns).toHaveLength(0);
    expect(document?.evidence).toHaveLength(0);
  });

  it('forks with a new identity and no source evidence or usage', async () => {
    const sourceStore = new InMemoryGoalStore();
    const targetStore = new InMemoryGoalStore();
    const source = new GoalService({ store: sourceStore, ownership: owner, now: () => 100 });
    const target = new GoalService({ store: targetStore, ownership: owner, now: () => 200 });
    const created = await source.create(userContext(null), {
      objective: 'ship it', completionCriterion: 'tests pass',
      expectedEvidenceKinds: ['file_artifact', 'command_action'], turnLimit: 7,
    });
    await source.recordTurn({ ...userContext(created.revision), requestSource: 'runtime' }, {
      turnId: 't1', tokensUsed: 50, activeWallClockMs: 10,
    });

    const forked = await target.fork({
      sessionId: 'sess_1', instanceId: 'inst_1', requestSource: 'user', expectedRevision: null,
    }, (await source.load('sess_1'))!.state);

    expect(forked.goalId).not.toBe(created.goalId);
    expect(forked).toMatchObject({
      revision: 1, epoch: 1, forkedFromGoalId: created.goalId,
      turnsUsed: 0, tokensUsed: 0, activeWallClockMs: 0,
    });
    expect((await target.load('sess_1'))!.evidence).toEqual([]);
    expect((await target.load('sess_1'))!.turns).toEqual([]);
  });

  it('atomically settles turn, evidence and a verified terminal decision', async () => {
    const store = new InMemoryGoalStore();
    const service = new GoalService({ store, ownership: owner, now: () => 300 });
    const created = await service.create(userContext(null), {
      objective: '回答问题', expectedEvidenceKinds: ['answer'], turnLimit: 1,
    });

    const completed = await service.settleTurn(
      { ...userContext(created.revision), requestSource: 'runtime' },
      {
        turnId: 'turn_1', tokensUsed: 12, activeWallClockMs: 30,
        evidence: [{
          ownerKind: 'goal', ownerId: created.goalId, kind: 'answer',
          summary: 'done', metadata: { responseId: 'response_1' },
        }],
        terminalDecision: { kind: 'complete', reason: 'verified evidence' },
      },
    );

    const document = await store.load('sess_1');
    expect(completed).toMatchObject({ status: 'complete', turnsUsed: 1, tokensUsed: 12 });
    expect(document?.turns).toHaveLength(1);
    expect(document?.evidence).toHaveLength(1);
    expect(document?.events.at(-1)?.type).toBe('turn_settled');
  });

  it('does not reset usage and requires a larger explicit limit for budget resume', async () => {
    const store = new InMemoryGoalStore();
    const service = new GoalService({ store, ownership: owner, now: () => 400 });
    const created = await service.create(userContext(null), {
      objective: '回答问题', expectedEvidenceKinds: ['answer'], turnLimit: 1,
    });
    const blocked = await service.settleTurn(
      { ...userContext(created.revision), requestSource: 'runtime' },
      { turnId: 'turn_1', tokensUsed: 5, activeWallClockMs: 6, terminalDecision: { kind: 'none' } },
    );

    await expect(service.resume(userContext(blocked.revision))).rejects.toThrow(/turn limit/i);
    const resumed = await service.resume(userContext(blocked.revision), { turnLimit: 2 });
    expect(resumed).toMatchObject({
      status: 'active', turnsUsed: 1, tokensUsed: 5, activeWallClockMs: 6,
      budgetLimits: { turnLimit: 2 },
    });
  });
});
