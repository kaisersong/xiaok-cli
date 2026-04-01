import { describe, expect, it } from 'vitest';
import { AgentSessionGraph } from '../../../src/ai/runtime/session-graph.js';

describe('AgentSessionGraph', () => {
  it('tracks prompt snapshots, memory refs, lineage, and approvals in one exportable document', () => {
    const graph = new AgentSessionGraph({
      sessionId: 'sess_1',
      cwd: '/repo',
      createdAt: 1,
      updatedAt: 1,
      lineage: ['sess_1'],
    });

    graph.attachPromptSnapshot('prompt_1', ['mem_1']);
    graph.appendUserText('hello');
    graph.recordApproval('apr_1');

    const snapshot = graph.exportSnapshot();
    expect(snapshot.promptSnapshotId).toBe('prompt_1');
    expect(snapshot.memoryRefs).toEqual(['mem_1']);
    expect(snapshot.approvalRefs).toEqual(['apr_1']);
    expect(snapshot.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });
});
