import { describe, expect, it } from 'vitest';

import { listLatestMorningSuggestions } from '../../electron/assistant-morning-suggestions.js';

describe('listLatestMorningSuggestions', () => {
  it('reads only the latest successful morning run and keeps at most three validated recommendations', () => {
    const suggestions = listLatestMorningSuggestions({
      listRuns: () => [
        { id: 'failed', status: 'failed' },
        { id: 'morning-2', status: 'success' },
        { id: 'morning-1', status: 'success' },
      ],
      listEvidence: runId => runId === 'morning-2' ? [{
        metadata: {
          assistantKind: 'morning',
          output: {
            recommendations: [
              { title: '先处理发布阻塞', reasonCode: 'release_blocked', evidenceRefs: [{ kind: 'task', id: 'task-1' }] },
              { title: '确认团队方案', reasonCode: 'team_plan_ready', evidenceRefs: [{ kind: 'project', id: 'project-1' }] },
              { title: '整理评审结论', reasonCode: 'review_ready', evidenceRefs: [{ kind: 'thread', id: 'thread-1' }] },
              { title: '越界建议', reasonCode: 'too_many', evidenceRefs: [{ kind: 'task', id: 'task-2' }] },
            ],
          },
        },
      }] : [],
    });

    expect(suggestions).toEqual([
      { id: 'morning-2:0', title: '先处理发布阻塞', summary: 'release_blocked' },
      { id: 'morning-2:1', title: '确认团队方案', summary: 'team_plan_ready' },
      { id: 'morning-2:2', title: '整理评审结论', summary: 'review_ready' },
    ]);
  });

  it('fails closed for malformed or non-morning evidence', () => {
    expect(listLatestMorningSuggestions({
      listRuns: () => [{ id: 'morning-1', status: 'success' }],
      listEvidence: () => [{ metadata: { assistantKind: 'evening', output: { recommendations: [{ title: 'wrong' }] } } }],
    })).toEqual([]);
  });
});
