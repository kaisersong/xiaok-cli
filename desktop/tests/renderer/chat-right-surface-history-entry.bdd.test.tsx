import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ChatRightSurface } from '../../renderer/src/components/ChatRightSurface';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

type Props = ComponentProps<typeof ChatRightSurface>;
beforeEach(() => {
  localStorage.setItem('xiaok:locale', 'zh');
  // Geometry only: real Surface/tabbable continue to decide visibility/focus.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === 'none') return [] as unknown as DOMRectList;
    }
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(width: number) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const initial: Props = { threadId: 'history-entry', agentCount: 0, hasAgentHistory: true,
    taskContent: null, canvasContent: null, canvasOpen: false, canvasRequestId: 0, canvasExpanded: false,
    agentsContent: <button type="button">saved history detail</button>, children: <textarea aria-label="composer" defaultValue="unsent" /> };
  return (patch: Partial<Props> = {}) => <LocaleProvider><ChatRightSurface {...initial} {...patch} /></LocaleProvider>;
}
const capsule = () => document.querySelector<HTMLButtonElement>('.chat-right-entry');
function closeOpenPanel() { if (screen.queryByRole('tabpanel')) fireEvent.click(screen.getByRole('button', { name: '收起侧栏' })); }

describe.each([899, 900])('user-requested history capsule removal at %s px', width => {
  it.each([false, true])('history-only with historicalSelection=%s retains the internal history tab but has no standalone capsule', historicalSelection => {
    const mount = setup(width); render(mount({ historicalSelection, agentCount: historicalSelection ? 3 : 0 }));
    expect(capsule()).toBeNull(); expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(document.querySelector('[id="right-history-entry-agents-tab"]')).not.toBeNull();
    expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });

  it.each(['task', 'canvas'] as const)('with %s content, keeps that existing capsule and the readable history tab without a history capsule', view => {
    const mount = setup(width); render(mount(view === 'task'
      ? { taskContent: <input aria-label="task draft" /> }
      : { canvasContent: <input aria-label="canvas draft" /> }));
    closeOpenPanel(); expect(capsule()).toHaveTextContent(view === 'task' ? '任务' : '画布');
    expect(capsule()).not.toHaveTextContent('SubAgent 历史'); fireEvent.click(capsule()!);
    expect(screen.getByRole('tabpanel', { name: view === 'task' ? '任务' : '画布' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'SubAgent' }));
    expect(screen.getByRole('button', { name: 'saved history detail' })).toBeVisible();
    expect(capsule()).toHaveTextContent(view === 'task' ? '任务' : '画布');
    expect(document.querySelectorAll('.chat-right-entry')).toHaveLength(1);
  });

  it('history plus recovery retains one execution-state entrance and no historical child count', () => {
    const mount = setup(width); render(mount({ needsRecovery: true, historicalSelection: true, agentCount: 3 }));
    expect(capsule()?.textContent).toBe('执行状态'); expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.click(capsule()!); expect(screen.getByRole('button', { name: 'saved history detail' })).toBeVisible();
  });

  it.each(['task', 'canvas'] as const)('history plus pending preserves open %s and prioritizes the same collapsed entrance only on user click', view => {
    const mount = setup(width);
    const patch: Partial<Props> = view === 'task' ? { taskContent: <input aria-label="task draft" /> }
      : { canvasContent: <input aria-label="canvas draft" />, canvasOpen: true };
    const rendered = render(mount(patch));
    if (!screen.queryByRole('tabpanel')) fireEvent.click(capsule()!);
    const input = screen.getByLabelText(`${view} draft`); input.focus();
    rendered.rerender(mount({ ...patch, pendingApprovalCount: 2 }));
    expect(screen.getByRole('tabpanel', { name: view === 'task' ? '任务' : '画布' })).toBeVisible(); expect(input).toHaveFocus();
    closeOpenPanel(); expect(capsule()?.textContent).toBe('执行状态 · 2 项待审批');
    fireEvent.click(capsule()!); expect(screen.getByRole('tabpanel', { name: /^SubAgent/ })).toBeVisible();
    expect(document.querySelectorAll('.chat-right-panel')).toHaveLength(1);
  });

  it('a real current child keeps the existing count entrance after collapse', () => {
    const mount = setup(width); render(mount({ agentCount: 2, historicalSelection: false }));
    closeOpenPanel(); expect(capsule()?.textContent).toBe('SubAgent · 2');
    fireEvent.click(capsule()!); expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
  });

  it('ending recovery removes a focused collapsed capsule while keeping history and returning only its owned focus', () => {
    const mount = setup(width); const rendered = render(mount({ needsRecovery: true }));
    capsule()!.focus(); rendered.rerender(mount());
    expect(capsule()).toBeNull(); expect(screen.getByLabelText('composer')).toHaveFocus();
    expect(document.querySelector('[id="right-history-entry-agents-tab"]')).not.toBeNull();
  });

  it('ending recovery while the user reads history does not close or steal focus; explicit close without capsule returns to composer', () => {
    const mount = setup(width); const rendered = render(mount({ needsRecovery: true }));
    fireEvent.click(capsule()!); const detail = screen.getByRole('button', { name: 'saved history detail' }); detail.focus();
    rendered.rerender(mount()); expect(capsule()).toBeNull(); expect(detail).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
    act(() => fireEvent.click(screen.getByRole('button', { name: '收起侧栏' })));
    expect(screen.getByLabelText('composer')).toHaveFocus(); expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
  });

  it('deleted still suppresses history, pending and recovery without suppressing an existing Task entrance', () => {
    const mount = setup(width); render(mount({ deleted: true, historicalSelection: true, agentCount: 3,
      needsRecovery: true, pendingApprovalCount: 4, taskContent: <input aria-label="task draft" /> }));
    closeOpenPanel(); expect(capsule()?.textContent).toBe('任务');
    fireEvent.click(capsule()!); expect(screen.queryByRole('tab', { name: 'SubAgent' })).toBeNull();
  });
});
