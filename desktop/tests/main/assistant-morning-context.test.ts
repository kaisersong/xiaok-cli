import { describe, expect, it } from 'vitest';

import { buildAssistantMorningContext } from '../../electron/assistant-morning-context.js';

describe('buildAssistantMorningContext', () => {
  it('adds the latest completed evening summary, pending candidates, and explicit pins to the bounded current snapshot', () => {
    expect(buildAssistantMorningContext({
      snapshot: { items: [{ id: 'today-task' }], dropped: {} },
      eveningRun: { id: 'evening-1', status: 'success', summary: '昨天完成了发布验证。' },
      pendingCandidates: [
        { id: 'candidate-1', kind: 'memory', title: '记住发布门禁' },
        { id: 'candidate-2', kind: 'knowledge', title: '归档评审结论' },
      ],
      pinnedThreadIds: ['thread-2', 'thread-1'],
    })).toEqual({
      current: { items: [{ id: 'today-task' }], dropped: {} },
      latestEvening: { runId: 'evening-1', summary: '昨天完成了发布验证。' },
      pendingCandidates: [
        { id: 'candidate-1', kind: 'memory', title: '记住发布门禁' },
        { id: 'candidate-2', kind: 'knowledge', title: '归档评审结论' },
      ],
      pinnedThreadIds: ['thread-1', 'thread-2'],
    });
  });

  it('caps unbounded durable lists and omits failed evening runs', () => {
    const result = buildAssistantMorningContext({
      snapshot: {},
      eveningRun: { id: 'evening-failed', status: 'failed', summary: '不可用' },
      pendingCandidates: Array.from({ length: 120 }, (_, index) => ({
        id: `candidate-${index}`,
        kind: 'follow_up',
        title: `建议 ${index}`,
      })),
      pinnedThreadIds: Array.from({ length: 120 }, (_, index) => `thread-${index}`),
    });

    expect(result.latestEvening).toBeNull();
    expect(result.pendingCandidates).toHaveLength(100);
    expect(result.pinnedThreadIds).toHaveLength(100);
  });
});
