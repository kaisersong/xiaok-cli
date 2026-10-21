import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GoalBar } from '../../renderer/src/components/GoalBar';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(cleanup);

describe('GoalBar', () => {
  it.each([
    [{ kind: 'unavailable' }, '当前验证不可查询'],
    [{ kind: 'protected', state: 'needs_revalidation' }, '需要重新验证'],
    [{ kind: 'protected', state: 'publication_pending' }, '等待完成结果发布'],
    [{ kind: 'protected', state: 'binding_pending' }, '等待目标绑定完成'],
    [{ kind: 'protected', state: 'binding_required' }, '目标尚未授权'],
    [{ kind: 'protected', state: 'binding_mismatch' }, '目标绑定已变化'],
    [{ kind: 'protected', state: 'verified' }, '已验证完成'],
  ] as const)('shows fresh Main verification instead of trusting cached complete: %s', (currentCompletion, label) => {
    render(<LocaleProvider><GoalBar goal={{ activation: 'disarmed', currentCompletion,
      state: { goalId: 'g', sessionId: 't', revision: 2, epoch: 1, objective: 'goal', expectedEvidenceKinds: ['answer'], status: 'complete',
        turnsUsed: 1, tokensUsed: 0, activeWallClockMs: 0, budgetLimits: { turnLimit: 4 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 2 },
    }} onCreate={vi.fn()} /></LocaleProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  });

  it.each([
    ['waiting_children', '等待子任务及结果交接'],
    ['children_need_attention', '子任务需要处理'],
  ] as const)('shows main-owned %s without offering or invoking an automatic continuation', (waitingReason, label) => {
    const onResume = vi.fn();
    render(<LocaleProvider><GoalBar goal={{ activation: 'armed', waitingReason,
      state: { goalId: 'g', sessionId: 't', revision: 2, epoch: 1, objective: 'goal', expectedEvidenceKinds: ['answer'], status: 'active',
        turnsUsed: 1, tokensUsed: 0, activeWallClockMs: 0, budgetLimits: { turnLimit: 4 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 2 },
    }} onCreate={vi.fn()} onResume={onResume} /></LocaleProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(label); expect(onResume).not.toHaveBeenCalled();
  });
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


it.each(['active', 'paused'] as const)('pending publication %s exposes query/continue instead of another task resume', status => {
  const recover = vi.fn(), publish = vi.fn(), resume = vi.fn(), pause = vi.fn();
  render(<LocaleProvider><GoalBar goal={{ activation: 'disarmed', state: {
    goalId: 'g', sessionId: 't', revision: 2, epoch: 1, objective: 'goal', expectedEvidenceKinds: ['answer'], status,
    pendingCompletionIntentId: 'claim', turnsUsed: 1, tokensUsed: 5, activeWallClockMs: 1,
    budgetLimits: { turnLimit: 1 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 2,
  } }} onCreate={vi.fn()} onResume={resume} onPause={pause} onRecoverPublication={recover} onContinuePublication={publish} /></LocaleProvider>);
  expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查询发布结果' }));
  fireEvent.click(screen.getByRole('button', { name: '继续完成确认' }));
  expect(recover).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
  if (status === 'active') { fireEvent.click(screen.getByRole('button', { name: '暂停' })); expect(pause).toHaveBeenCalledOnce(); }
});

it('passes explicit original verification JSON through the user form without deriving expected answers',()=>{
 const onCreate=vi.fn(),definition={version:1,obligations:[{obligationId:'original'}]};render(<LocaleProvider><GoalBar goal={null} initialEditing onCreate={onCreate}/></LocaleProvider>);
 fireEvent.change(screen.getByLabelText('目标'),{target:{value:'original'}});fireEvent.change(screen.getByLabelText('原始验收定义（JSON）'),{target:{value:JSON.stringify(definition)}});fireEvent.click(screen.getByRole('button',{name:'确认创建'}));expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({verificationDefinition:definition}));
});
it('shows a pending mutation without inventing an active Goal and offers only explicit recovery, continuation and cancellation',()=>{
 const recover=vi.fn(),proceed=vi.fn(),cancel=vi.fn();render(<LocaleProvider><GoalBar goal={null} nativeMutation={{id:'request',kind:'create',status:'enrolled',objective:'original'}} onCreate={vi.fn()} onRecoverNative={recover} onContinueNative={proceed} onCancelNative={cancel}/></LocaleProvider>);
 expect(screen.getByText('目标变更尚未生效')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'恢复批准结果'}));fireEvent.click(screen.getByRole('button',{name:'继续目标变更'}));fireEvent.click(screen.getByRole('button',{name:'取消本次变更'}));expect(recover).toHaveBeenCalledOnce();expect(proceed).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();expect(screen.queryByText('进行中')).not.toBeInTheDocument();
});
it('rejects malformed JSON before calling main and displays a localized error',()=>{
 const onCreate=vi.fn();render(<LocaleProvider><GoalBar goal={null} initialEditing onCreate={onCreate}/></LocaleProvider>);fireEvent.change(screen.getByLabelText('目标'),{target:{value:'original'}});fireEvent.change(screen.getByLabelText('原始验收定义（JSON）'),{target:{value:'{broken'}});fireEvent.click(screen.getByRole('button',{name:'确认创建'}));expect(onCreate).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('验收定义不是有效的 JSON');
});
