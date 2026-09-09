import { describe, expect, it } from 'vitest';
import { MultiAgentProgressView } from '../../src/ui/multi-agent-progress.js';
import type { MultiAgentEvent } from '../../src/ai/agents/multi-agent-coordinator.js';

function event(id: string, taskName: string, status = 'running'): MultiAgentEvent {
  return { kind: 'status', timestamp: 1_000, agent: { id, taskName, canonicalName: `/root/${taskName}`, parentId: 'main', depth: 1,
    status: status as 'running', unreadMessages: 0, turn: 1, startedAt: 1_000, lastActivityAt: 2_000, phase: 'tool', currentTool: 'read', executionActive: status === 'running', resourcesReleased: false } };
}

describe('multi-agent progress view', () => {
  it('shows unsettled tool cleanup without pretending the agent is closed',()=>{
    const view=new MultiAgentProgressView();const update=event('held','held');update.agent.executionHealth='cleanup_pending';view.update(update);
    expect(view.summary()).toContain('等待退出·清理中');expect(view.summary()).not.toContain('已关闭');
  });
  it('shows both children and current tool while main is waiting, with live elapsed/idle ages', () => {
    const view = new MultiAgentProgressView();
    view.update(event('a', 'review_runtime'));
    view.update(event('b', 'review_tests', 'completed'));
    const summary = view.summary(12_000, 160);
    expect(summary).toContain('review_runtime');
    expect(summary).toContain('read');
    expect(summary).toContain('review_tests');
    expect(summary).toContain('完成');
    expect(summary).toContain('11s');
    expect(summary).toContain('10s');
    expect(view.summary(22_000, 160)).toContain('21s');
  });

  it('bounds narrow output, strips terminal controls and distinguishes closed from physical release', () => {
    const view = new MultiAgentProgressView();
    const update = event('a', 'unsafe\u001b[2J\nname', 'closed');
    update.agent.executionActive = true;
    view.update(update);
    const summary = view.summary(12_000, 80);
    expect(summary).not.toMatch(/[\u001b\n\r]/);
    expect(summary).toContain('清理中');
    expect(view.summary(12_000, 35).length).toBeLessThanOrEqual(35);
    update.agent.resourcesReleased = true;
    update.agent.executionActive = false;
    view.update(update);
    expect(view.summary(12_000, 80)).not.toContain('清理中');
  });
});
