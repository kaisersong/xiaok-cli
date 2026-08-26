import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GoalBar } from '../../renderer/src/components/GoalBar';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(cleanup);

describe('GoalBar', () => {
  it('opens the explicit Goal form immediately for a semantic Splash entry', () => {
    const onCreate = vi.fn();
    render(<LocaleProvider><GoalBar goal={null} initialEditing onCreate={onCreate} /></LocaleProvider>);
    expect(screen.getByLabelText('目标')).toBeInTheDocument();
    expect(screen.getByLabelText('完成条件')).toBeInTheDocument();
    expect(screen.getByLabelText('轮次预算')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a Goal from explicit objective, criterion, evidence, and budget fields', () => {
    const onCreate = vi.fn();
    render(<LocaleProvider><GoalBar goal={null} onCreate={onCreate} /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: '创建目标' }));
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '发布新版 CLI' } });
    fireEvent.change(screen.getByLabelText('完成条件'), { target: { value: '测试通过' } });
    fireEvent.change(screen.getByLabelText('轮次预算'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
    expect(onCreate).toHaveBeenCalledWith({
      objective: '发布新版 CLI', completionCriterion: '测试通过',
      expectedEvidenceKinds: ['answer'], turnLimit: 8,
    });
  });

  it('shows durable active state and user-owned pause/cancel controls', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    render(<LocaleProvider><GoalBar goal={{
      activation: 'armed',
      state: {
        goalId: 'goal_1', sessionId: 'thread_1', revision: 2, epoch: 1,
        objective: '完成报告', expectedEvidenceKinds: ['file_artifact'], status: 'active',
        turnsUsed: 2, tokensUsed: 120, activeWallClockMs: 100,
        budgetLimits: { turnLimit: 6 }, consecutiveBlockedTurns: 0,
        createdAt: 1, updatedAt: 2,
      },
    }} onCreate={vi.fn()} onPause={onPause} onCancel={onCancel} /></LocaleProvider>);
    expect(screen.getByText('完成报告')).toBeTruthy();
    expect(screen.getByText('2 / 6 轮')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    fireEvent.click(screen.getByRole('button', { name: '取消目标' }));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses one responsive status surface with expandable secondary details', () => {
    const { container } = render(<LocaleProvider><GoalBar goal={{
      activation: 'armed',
      state: {
        goalId: 'goal_1', sessionId: 'thread_1', revision: 2, epoch: 1,
        objective: '完成复杂报告', expectedEvidenceKinds: ['file_artifact'], status: 'active',
        turnsUsed: 2, tokensUsed: 120, activeWallClockMs: 100,
        budgetLimits: { turnLimit: 6 }, consecutiveBlockedTurns: 0,
        createdAt: 1, updatedAt: 2,
      },
    }} onCreate={vi.fn()} onPause={vi.fn()} /></LocaleProvider>);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getAllByText('2 / 6 轮')).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: '展开目标详情' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.goal-panel')?.classList.contains('is-expanded')).toBe(true);
    expect(screen.getByText('完成复杂报告')).toBeInTheDocument();
  });

  it('requires a larger explicit budget when turn budget is exhausted', () => {
    const onResume = vi.fn();
    render(<LocaleProvider><GoalBar goal={{
      activation: 'disarmed',
      state: {
        goalId: 'goal_1', sessionId: 'thread_1', revision: 3, epoch: 1,
        objective: '完成报告', expectedEvidenceKinds: ['answer'], status: 'blocked',
        turnsUsed: 5, tokensUsed: 0, activeWallClockMs: 0,
        budgetLimits: { turnLimit: 5 }, consecutiveBlockedTurns: 0,
        terminalReason: 'turn_budget_exhausted', createdAt: 1, updatedAt: 2,
      },
    }} onCreate={vi.fn()} onResume={onResume} /></LocaleProvider>);
    const input = screen.getByLabelText('新轮次预算');
    expect(input.getAttribute('min')).toBe('6');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '增加预算并恢复' }));
    expect(onResume).toHaveBeenCalledWith(7);
  });
});
