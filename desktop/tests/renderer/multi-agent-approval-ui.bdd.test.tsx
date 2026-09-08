import { createHash } from 'node:crypto';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import { ChatRightSurface } from '../../renderer/src/components/ChatRightSurface';
import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { approval, approvalFixture, compact, deferred, snapshot, type ApprovalAPI, type ApprovalView } from './approval-ui-fixture';

vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <textarea aria-label="ordinary draft" defaultValue="keep ordinary draft" /> }));
const stops: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Surface({ connection, api, width, taskCanvas }: { connection: MultiAgentConnection; api: ApprovalAPI; width: number; taskCanvas: boolean }) {
  const summary = useSyncExternalStore(connection.subscribe, connection.getSummary);
  const props: ComponentProps<typeof ChatRightSurface> & { pendingApprovalCount: number } = {
    threadId: connection.threadId, agentCount: summary.total, hasAgentHistory: summary.hasAgentHistory, needsRecovery: summary.needsRecovery,
    historicalSelection: summary.historicalSelection, deleted: summary.deleted,
    pendingApprovalCount: (summary as typeof summary & { pendingApprovalCount?: number }).pendingApprovalCount ?? 0,
    canvasOpen: false, canvasExpanded: false, canvasRequestId: 0,
    taskContent: taskCanvas ? <input aria-label="Task field" defaultValue="Task input" /> : undefined,
    canvasContent: taskCanvas ? <input aria-label="Canvas field" defaultValue="Canvas input" /> : undefined,
    agentsContent: <MultiAgentPanel connection={connection} api={api} onSelectGroup={vi.fn()} />,
    children: <textarea aria-label={`composer-${width}`} defaultValue="draft survives" />,
  };
  return <ChatRightSurface {...props} />;
}
async function mount(f: ReturnType<typeof approvalFixture>, options: { surface?: number; taskCanvas?: boolean; selectedGroupId?: string; question?: boolean } = {}) {
  const connection = new MultiAgentConnection(f.api, 'thread', options.selectedGroupId); stops.push(connection.start());
  const onAnswer = vi.fn();
  if (options.surface !== undefined) vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: options.surface } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  const draw = (next = connection, api = f.api) => <LocaleProvider>
    {options.surface === undefined ? <MultiAgentPanel connection={next} api={api} onSelectGroup={vi.fn()} />
      : <Surface connection={next} api={api} width={options.surface} taskCanvas={options.taskCanvas ?? false} />}
    {options.question ? <ChatView thread={{ id: 'thread', title: 'Question', status: 'idle', mode: 'work', createdAt: 1, updatedAt: 1,
      starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: null, taskIds: [] }} messages={[]} streamingText="" status="waiting_user"
      currentQuestion={{ taskId: 'question-task', questionId: 'question', kind: 'confirm_understanding', prompt: 'Task question, not a tool grant', choices: [{ id: 'confirm', label: '确认任务理解' }] }}
      result={null} generatedFiles={[]} prompt="" onPromptChange={vi.fn()} onSubmit={vi.fn()} onAnswer={onAnswer} onCancel={vi.fn()}
      canvasOpen={false} onToggleCanvas={vi.fn()} /> : null}
  </LocaleProvider>;
  let mounted!: ReturnType<typeof render>;
  await act(async () => { mounted = render(draw()); });
  return { connection, onAnswer, rerender: async (next: MultiAgentConnection, api: typeof f.api) => { await act(async () => mounted.rerender(draw(next, api))); } };
}
const cards = () => screen.getAllByRole('region', { name: /工具审批/ });

describe('AP7: actual inline approval cards and the single right surface', () => {
  it.each([899, 900])('root-only pending with existing Task content at %s px remains collapsed until the user clicks its counted approval entry', async width => {
    const f = approvalFixture(); await mount(f, { surface: width, taskCanvas: true });
    if (width === 900) fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    const composer = screen.getByLabelText(`composer-${width}`); composer.focus();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    const entry = document.querySelector('.chat-right-entry')!;
    expect(entry).toHaveAccessibleName(/执行状态.*1 项待审批/);
    expect(composer).toHaveFocus(); expect(composer).toHaveValue('draft survives');
    fireEvent.click(entry);
    expect(screen.getByRole('tabpanel', { name: /执行状态/ })).toBeVisible();
    expect(cards()).toHaveLength(1); expect(document.querySelectorAll('.chat-right-panel')).toHaveLength(1);
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it('a pending count on a collapsed historical selection opens that same readonly history rather than changing groups', async () => {
    const initial = snapshot([]);
    initial.group = { ...initial.group!, historicalOnly: true };
    initial.activeGroupId = 'current'; initial.pendingApprovalCount = 1; initial.hasAgentHistory = true;
    const f = approvalFixture([], initial); await mount(f, { surface: 900, taskCanvas: true, selectedGroupId: 'g' });
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    const entry = document.querySelector('.chat-right-entry')!;
    expect(entry).toHaveAccessibleName(/执行状态.*1 项待审批/);
    fireEvent.click(entry);
    expect(screen.getByText('历史记录，只读')).toBeVisible();
    expect(screen.getByText('当前执行组有 1 项待审批；此处为历史记录。')).toBeVisible();
    expect(screen.getByRole('button', { name: '当前执行组' })).toBeVisible();
    expect(f.api.subscribeMultiAgents.mock.calls.every(([input]) => input.groupId === 'g')).toBe(true);
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it('a deleted thread cannot preserve the collapsed approval badge or reopen its old pending cards', async () => {
    const f = approvalFixture(); await mount(f, { surface: 899, taskCanvas: true });
    expect(document.querySelector('.chat-right-entry')).toHaveAccessibleName(/1 项待审批/);
    const deleted = { ...f.current(), threadRevision: 2, threadDeleteState: 'deleted' as const, activeGroupId: null,
      group: null, root: null, agents: [], residentAgents: [], hasAgentHistory: false, pendingApprovalCount: 0, pendingApprovals: [] };
    f.setSnapshot(deleted);
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g',
      newGroupId: null, threadDeleteState: 'deleted', hasAgentHistory: false, pendingApprovalCount: 0 }));
    // The real connection publishes coalesced ordinary envelopes on its
    // existing timer; await the rendered deletion instead of treating act as a clock.
    const entry = await screen.findByRole('button', { name: '任务' });
    expect(entry).toHaveClass('chat-right-entry'); fireEvent.click(entry);
    expect(screen.queryByRole('region', { name: /工具审批/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /执行状态|SubAgent/ })).toBeNull();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it.each([899, 900])('root-only pending at %s px creates only the existing execution-state entry and never auto-opens or steals focus', async width => {
    const f = approvalFixture(); await mount(f, { surface: width });
    const composer = screen.getByLabelText(`composer-${width}`); composer.focus();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    const entry = screen.getByRole('button', { name: /执行状态/ });
    expect(entry.textContent).not.toContain('SubAgent'); expect(entry.textContent).not.toMatch(/\b0\b/);
    expect(composer).toHaveFocus(); expect(composer).toHaveValue('draft survives');
    fireEvent.click(entry);
    expect(document.querySelectorAll('.chat-right-panel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: /执行状态/ })).toBeVisible();
    expect(cards()).toHaveLength(1);
  });

  it('pending approvals keep Task/Canvas selection and draft focus while adding a badge to the same tabs', async () => {
    const f = approvalFixture(); await mount(f, { surface: 900, taskCanvas: true });
    const task = screen.getByLabelText('Task field'); task.focus();
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /执行状态.*1|1.*执行状态/ })).toBeVisible();
    expect(task).toHaveFocus();
    fireEvent.click(screen.getByRole('tab', { name: '画布' }));
    const canvas = screen.getByLabelText('Canvas field'); canvas.focus();
    const updated = { ...f.current(), threadRevision: 2 }; f.setSnapshot(updated);
    await act(async () => { f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g', newGroupId: 'g', pendingApprovalCount: 1 }); });
    expect(canvas).toHaveFocus(); expect(canvas).toHaveValue('Canvas input');
    expect(document.querySelectorAll('.chat-right-panel')).toHaveLength(1);
  });

  it('nine pending members obtain metadata once per approval, render real identity and never use input pages just to show digest', async () => {
    const views = [approval(), ...Array.from({ length: 8 }, (_, index) => approval(`approval-${index}`, `child-${index}`))];
    const f = approvalFixture(views); await mount(f);
    expect(cards()).toHaveLength(9);
    await vi.waitFor(() => expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(9));
    for (const view of views) {
      expect(f.api.getMultiAgentApproval).toHaveBeenCalledWith({ threadId: 'thread', groupId: 'g', approvalId: view.approvalId });
      expect(screen.getAllByText(view.agentId).length).toBeGreaterThan(0);
      expect(screen.getAllByText(view.turnId).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: '仅批准本次' })).toHaveLength(9);
    expect(f.api.getMultiAgentApproval.mock.calls.every(([input]) => input.inputOffset === undefined)).toBe(true);
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });
  it('pending approval uses the existing polite announcement surface without another live region', async () => {
    const f = approvalFixture(); await mount(f);
    const announcements = document.querySelectorAll('[aria-live="polite"][aria-atomic="true"]');
    expect(announcements).toHaveLength(1); expect(announcements[0]).toHaveTextContent('1 项待审批');
  });

  it('a compact pending row is not decidable until its exact metadata response arrives', async () => {
    const view = approval(), f = approvalFixture([view]), response = deferred<ApprovalView>();
    f.api.getMultiAgentApproval.mockReturnValue(response.promise); await mount(f);
    expect(cards()).toHaveLength(1);
    const before = screen.queryByRole('button', { name: '仅批准本次' });
    if (before) { expect(before).toBeDisabled(); fireEvent.click(before); }
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
    await act(async () => response.resolve(view));
    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeEnabled();
  });
  it('a failed metadata read is recoverable only by explicit retry of that same card', async () => {
    const view = approval(), f = approvalFixture([view]); f.api.getMultiAgentApproval.mockRejectedValueOnce(new Error('read unavailable'));
    await mount(f); expect(screen.getByRole('button', { name: '仅批准本次' })).toBeDisabled();
    expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(1);
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: '重新读取调用信息' })); await act(async () => {});
    expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(2); expect(screen.getByRole('button', { name: '仅批准本次' })).toBeEnabled();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it.each(['approve', 'deny'] as const)('Task Question and tool %s stay separate and only the clicked invocation is decided', async decision => {
    const views = [approval(), approval('approval-child', 'child')], f = approvalFixture(views);
    const mounted = await mount(f, { question: true });
    fireEvent.click(screen.getByRole('button', { name: '确认任务理解' }));
    expect(mounted.onAnswer).toHaveBeenCalledExactlyOnceWith('confirm'); expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(2);
    const button = screen.getAllByRole('button', { name: decision === 'approve' ? '仅批准本次' : '拒绝本次' })[1]!;
    fireEvent.click(button); await act(async () => {});
    expect(f.api.decideMultiAgentApproval).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread', groupId: 'g', approvalId: 'approval-child', operationId: expect.any(String), decision });
    expect(mounted.onAnswer).toHaveBeenCalledTimes(1);
    expect(f.api.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('unknown decision ACK keeps the exact operation and offers only its read query without another tool decision', async () => {
    const f = approvalFixture();
    f.api.decideMultiAgentApproval.mockImplementation(async input => ({ operationId: input.operationId, groupId: 'g', state: 'unknown' }));
    await mount(f); expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '仅批准本次' })); await act(async () => {});
    const original = f.api.decideMultiAgentApproval.mock.calls[0]![0];
    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '查询审批操作' })); await act(async () => {});
    expect(f.api.getMultiAgentOperation).toHaveBeenCalledWith({ threadId: 'thread', groupId: 'g', operationId: original.operationId });
    expect(f.api.decideMultiAgentApproval).toHaveBeenCalledTimes(1);
  });

  it.each(['groupId', 'approvalId', 'turnId', 'inputSha256'] as const)('a metadata response with different %s cannot enable or reveal a different invocation', async field => {
    const view = approval(), f = approvalFixture([view]);
    f.api.getMultiAgentApproval.mockResolvedValue({ ...view, [field]: field === 'inputSha256' ? 'b'.repeat(64) : 'OTHER_INVOCATION' });
    await mount(f); expect(cards()).toHaveLength(1);
    await vi.waitFor(() => expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(1));
    const button = screen.queryByRole('button', { name: '仅批准本次' }); if (button) expect(button).toBeDisabled();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
    expect(screen.queryByText('OTHER_INVOCATION')).toBeNull();
  });

  it.each(['api', 'thread', 'deleted'] as const)('late metadata after %s replacement cannot populate the current card or enable a decision', async change => {
    const f = approvalFixture(), late = deferred<ApprovalView>(); f.api.getMultiAgentApproval.mockReturnValue(late.promise);
    const mounted = await mount(f); expect(cards()).toHaveLength(1);
    const nextView = approval('next', 'child-next'), nextState = snapshot([nextView]);
    if (change === 'thread') { nextView.threadId = 'other'; nextState.threadId = 'other'; nextState.group!.threadId = 'other'; }
    if (change === 'deleted') { nextState.threadDeleteState = 'deleted'; nextState.threadRevision = 2; nextState.pendingApprovalCount = 0; nextState.pendingApprovals = []; }
    const next = approvalFixture([nextView], nextState), connection = new MultiAgentConnection(next.api, nextState.threadId); stops.push(connection.start());
    await mounted.rerender(connection, next.api);
    await act(async () => late.resolve({ ...approval(), toolName: 'OLD_TOOL_MUST_NOT_APPEAR' }));
    expect(screen.queryByText('OLD_TOOL_MUST_NOT_APPEAR')).toBeNull();
    if (change === 'deleted') expect(screen.queryAllByRole('region', { name: /工具审批/ })).toHaveLength(0);
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it.each(['zh', 'en'] as const)('explicit %s input pages show the current byte range, preserve split UTF-8 and keep the DOM bounded', async language => {
    localStorage.setItem('xiaok:locale', language);
    const text = JSON.stringify({ content: `${'x'.repeat(32751)}甲😀<img src=x onerror=alert(1)>` });
    const bytes = Buffer.from(text), digest = createHash('sha256').update(bytes).digest('hex');
    const view = { ...approval(), inputByteLength: bytes.length, inputSha256: digest }, f = approvalFixture([view]);
    f.api.getMultiAgentApproval.mockImplementation(async input => {
      if (input.inputOffset === undefined) return view;
      const offset = input.inputOffset, body = bytes.subarray(offset, offset + 32768);
      return { ...view, inputPage: { offset, base64: body.toString('base64'), nextOffset: offset + body.length, byteLength: bytes.length, sha256: digest } };
    });
    await mount(f);
    const card = () => screen.getByRole('region', { name: language === 'zh' ? /工具审批/ : /Tool approval/ });
    fireEvent.click(screen.getByRole('button', { name: language === 'zh' ? '查看本次参数' : 'View invocation input' })); await act(async () => {});
    const firstText = card().querySelector('pre')!.textContent!;
    expect(card()).toHaveTextContent(language === 'zh' ? `仅显示本页；源字节区间 [0, 32768)，已读取 32768 / ${bytes.length} 字节`
      : `Current page only; source bytes [0, 32768), ${32768} / ${bytes.length} bytes read`);
    // The existing limit is a byte page, not a new download/full-document UI.
    fireEvent.click(screen.getByRole('button', { name: language === 'zh' ? '读取下一页参数' : 'Read next input page' })); await act(async () => {});
    expect(f.api.getMultiAgentApproval).toHaveBeenCalledWith({ threadId: 'thread', groupId: 'g', approvalId: view.approvalId, inputOffset: 0 });
    expect(f.api.getMultiAgentApproval).toHaveBeenCalledWith({ threadId: 'thread', groupId: 'g', approvalId: view.approvalId, inputOffset: 32768 });
    await vi.waitFor(() => expect(card().querySelector('pre')).not.toBeNull());
    const currentText = card().querySelector('pre')!.textContent!;
    expect(card()).toHaveTextContent(language === 'zh' ? `仅显示本页；源字节区间 [32768, ${bytes.length})，已读取 ${bytes.length} / ${bytes.length} 字节`
      : `Current page only; source bytes [32768, ${bytes.length}), ${bytes.length} / ${bytes.length} bytes read`);
    expect(currentText).not.toBe(text); expect(currentText.length).toBeLessThan(32768);
    const content = firstText + currentText;
    expect(content).toBe(text); expect(content).toContain('甲😀<img src=x onerror=alert(1)>'); expect(content).not.toContain('�');
    expect(card().querySelector('img')).toBeNull();
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });

  it('input pages are unavailable after metadata becomes unknown, and a late page cannot restore retained input', async () => {
    const view = approval(), f = approvalFixture([view]), page = deferred<ApprovalView>();
    f.api.getMultiAgentApproval.mockImplementation(input => input.inputOffset === undefined ? Promise.resolve(view) : page.promise);
    const mounted = await mount(f); expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '查看本次参数' }));
    const failed = { ...view, persistenceState: 'unknown' as const, canDecide: false };
    f.metadata.set(view.approvalId, failed); f.setSnapshot({ ...f.current(), threadRevision: 2, pendingApprovalCount: 0, pendingApprovals: [compact(failed)],
      approvalFailure: { groupId: 'g', bootId: 'boot', code: 'multi_agent_approval_persistence_failed' } });
    act(() => mounted.connection.refresh());
    await vi.waitFor(() => expect(f.api.getMultiAgentSnapshot).toHaveBeenCalled());
    await act(async () => page.resolve({ ...view, inputPage: { offset: 0, nextOffset: 8, byteLength: 8, sha256: view.inputSha256, base64: Buffer.from('SECRET!!').toString('base64') } }));
    expect(screen.queryByText(/SECRET!!/)).toBeNull();
    const button = screen.queryByRole('button', { name: '仅批准本次' }); if (button) expect(button).toBeDisabled();
  });

  it.each(['unknown', 'reject'] as const)('a %s decision remains query-only across a same-invocation reconnect', async outcome => {
    const f = approvalFixture();
    f.api.decideMultiAgentApproval.mockImplementation(async input => {
      if (outcome === 'reject') throw new Error('decision transport failed');
      return { operationId: input.operationId, groupId: 'g', state: 'unknown' };
    });
    const mounted = await mount(f);
    fireEvent.click(screen.getByRole('button', { name: '仅批准本次' })); await act(async () => {});
    const original = f.api.decideMultiAgentApproval.mock.calls[0]![0];
    act(() => { stops.push(mounted.connection.start()); }); await act(async () => {});
    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '查询审批操作' })); await act(async () => {});
    expect(f.api.getMultiAgentOperation).toHaveBeenCalledWith({ threadId: 'thread', groupId: 'g', operationId: original.operationId });
    expect(f.api.decideMultiAgentApproval).toHaveBeenCalledTimes(1);
  });

  it.each(['nextOffset', 'offset', 'sha256', 'byteLength', 'base64'] as const)('rejects actual input-page %s corruption without displaying bytes or retrying automatically', async field => {
    const bytes = Buffer.from('{"x":1}'), digest = createHash('sha256').update(bytes).digest('hex');
    const view = { ...approval(), inputByteLength: bytes.length, inputSha256: digest }, f = approvalFixture([view]);
    f.api.getMultiAgentApproval.mockImplementation(async input => input.inputOffset === undefined ? view : { ...view, inputPage: {
      offset: 0, nextOffset: bytes.length, byteLength: bytes.length, sha256: digest, base64: bytes.toString('base64'),
      [field]: field === 'sha256' ? 'b'.repeat(64) : field === 'base64' ? '%%%=' : 1,
    } });
    await mount(f); fireEvent.click(screen.getByRole('button', { name: '查看本次参数' })); await act(async () => {});
    expect(screen.getByText('参数读取或校验失败，请手动重读。')).toBeVisible();
    expect(cards()[0]!.querySelector('pre')).toBeNull(); expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(2);
  });

  it('a wall deadline reached before a click prevents deciding without waiting for the display timer', async () => {
    const f = approvalFixture(), deadline = f.current().pendingApprovals[0]!.minDeadlineAt; await mount(f);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline);
    fireEvent.click(screen.getByRole('button', { name: '仅批准本次' })); await act(async () => {});
    expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled(); clock.mockRestore();
  });

  it('English approval buttons are localized and separate from authorization controls', async () => {
    localStorage.setItem('xiaok:locale', 'en'); const f = approvalFixture(); await mount(f);
    expect(screen.getByRole('region', { name: /Tool approval/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve this invocation only' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deny this invocation' })).toBeVisible();
  });
  it.each([899, 900])('last root-only approval ends at %s px and the existing surface returns owned focus to the composer', async width => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      for (let node: HTMLElement | null = this; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return [] as unknown as DOMRectList;
      return [{ width: 10, height: 10 }] as unknown as DOMRectList;
    });
    const f = approvalFixture(); await mount(f, { surface: width });
    fireEvent.click(screen.getByRole('button', { name: /执行状态/ })); screen.getByRole('button', { name: '仅批准本次' }).focus();
    f.setSnapshot({ ...snapshot([]), threadRevision: 2 });
    await act(async () => f.emit({ channel: 'group_changed', threadId: 'thread', threadRevision: 2, oldGroupId: 'g', newGroupId: 'g', pendingApprovalCount: 0 }));
    await vi.waitFor(() => expect(screen.queryByRole('tabpanel')).toBeNull());
    expect(screen.getByLabelText(`composer-${width}`)).toHaveFocus(); expect(document.querySelectorAll('.chat-right-panel')).toHaveLength(1);
  });
  it('workspace denial disables new execution but keeps the existing resource inspection entry available', async () => {
    const f = approvalFixture();
    f.api.subscribeLocalExecutionAuthorization.mockImplementation(async input => ({ subscriptionId: input.subscriptionId,
      authorization: { bootId: 'boot', permissionRevision: 1, executionAllowed: false, persistenceState: 'confirmed' } }));
    await mount(f);
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '工作树与清理状态' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '前往执行授权设置' })).toBeVisible();
    const listener = vi.fn(); window.addEventListener('xiaok:app:open-settings', listener);
    fireEvent.click(screen.getByRole('button', { name: '前往执行授权设置' }));
    expect(listener).toHaveBeenCalledTimes(1); window.removeEventListener('xiaok:app:open-settings', listener);
    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeDisabled();
  });
  it.each(['empty', 'missing-subtle', 'late-digest'] as const)('parameter verification handles %s without automatic retry or stale text', async mode => {
    const raw = mode === 'empty' ? '' : 'SECRET', buffer = Buffer.from(raw), hash = createHash('sha256').update(buffer).digest('hex');
    const view = { ...approval(), inputByteLength: buffer.length, inputSha256: hash }, f = approvalFixture([view]);
    f.api.getMultiAgentApproval.mockImplementation(async input => input.inputOffset === undefined ? view : { ...view,
      inputPage: { offset: 0, base64: buffer.toString('base64'), nextOffset: buffer.length, byteLength: buffer.length, sha256: hash } });
    const actualCrypto = globalThis.crypto, digest = deferred<ArrayBuffer>();
    const spy = mode === 'missing-subtle' ? undefined : vi.spyOn(actualCrypto.subtle, 'digest');
    if (mode === 'late-digest') spy!.mockReturnValue(digest.promise);
    if (mode === 'missing-subtle') vi.stubGlobal('crypto', { randomUUID: actualCrypto.randomUUID.bind(actualCrypto), subtle: undefined });
    const mounted = await mount(f); fireEvent.click(screen.getByRole('button', { name: '查看本次参数' })); await act(async () => {});
    if (mode === 'missing-subtle') expect(screen.getByText('参数读取或校验失败，请手动重读。')).toBeVisible();
    else {
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      if (mode === 'empty') await vi.waitFor(() => expect(cards()[0]!.querySelector('pre')).not.toBeNull());
      else {
        f.setSnapshot({ ...f.current(), threadRevision: 2, threadDeleteState: 'delete_pending', pendingApprovalCount: 0 });
        act(() => mounted.connection.refresh());
        await vi.waitFor(() => expect(screen.getByText(/仍有执行或资源尚未回收/)).toBeVisible());
        await act(async () => digest.resolve(new Uint8Array(Buffer.from(hash, 'hex')).buffer));
        expect(screen.queryByText('SECRET')).toBeNull();
      }
    }
    expect(f.api.getMultiAgentApproval).toHaveBeenCalledTimes(2); expect(f.api.decideMultiAgentApproval).not.toHaveBeenCalled();
  });
});
