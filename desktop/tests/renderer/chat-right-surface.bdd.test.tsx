import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profiler, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ChatRightSurface } from '../../renderer/src/components/ChatRightSurface';
import { CanvasPanel } from '../../renderer/src/components/CanvasPanel';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

vi.mock('../../renderer/src/components/CanvasPreview', () => ({ CanvasPreview: () => <input aria-label="preview draft" defaultValue="kept" /> }));
vi.mock('../../renderer/src/components/WorkspaceTree', () => ({ WorkspaceTree: () => <span /> }));
vi.mock('../../renderer/src/components/ToolsPanel', () => ({ ToolsPanel: () => <button>tool leaf</button> }));
vi.mock('../../renderer/src/components/artifact-workspace/ArtifactWorkspacePanel', () => ({ ArtifactWorkspacePanel: () => <span /> }));

beforeEach(() => {
  // JSDOM 29 returns comma-selector matches in selector order for the
  // tabbable selector (e.g. a later link before earlier buttons). Restore
  // querySelectorAll's document-order contract, not tabbable's algorithm.
  const query = Element.prototype.querySelectorAll;
  vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function (this: Element, selectors: string) {
    const nodes = [...query.call(this, selectors)].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1);
    return Object.assign(nodes, { item: (index: number) => nodes[index] ?? null }) as unknown as NodeListOf<Element>;
  });
  // JSDOM has no layout. Supply geometry, not a replacement tab-order
  // implementation; production visibility/inert/radio logic remains real.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return [] as unknown as DOMRectList;
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  });
});

let resize: (width: number) => void;
function setup(width = 1200) {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) { resize = width => this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() { resize(width); } disconnect() {}
  });
  const props = { threadId: 'thread', agentCount: 0, hasAgentHistory: true, canvasOpen: false, canvasRequestId: 0, canvasExpanded: false,
    taskContent: <input aria-label="task draft" defaultValue="task kept" />, agentsContent: <button>child detail</button>,
    canvasContent: <input aria-label="canvas draft" defaultValue="canvas kept" />,
    children: <input aria-label="composer" defaultValue="unsent" /> };
  const mount = (patch = {}) => <LocaleProvider><ChatRightSurface {...props} {...patch} /></LocaleProvider>;
  return { props, mount };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('BDD: one Task / Agents / Canvas right surface', () => {
  it('external pointer followed by its real null blur relinquishes Canvas focus before a later Canvas unmount', () => {
    const { mount } = setup(900);
    const tree = (open: boolean) => <><div data-testid="outside-blank">external blank</div>{mount({ canvasOpen: open, canvasContent: open ? <input aria-label="canvas focus" /> : null })}</>;
    const view = render(tree(true)); const input = screen.getByLabelText('canvas focus'); input.focus();
    fireEvent.pointerDown(screen.getByTestId('outside-blank'));
    // JSDOM does not implement pointer default focusing; actual element.blur()
    // supplies the native null-relatedTarget transition proven by Electron.
    input.blur(); fireEvent.pointerUp(screen.getByTestId('outside-blank'));
    expect(document.activeElement).toBe(document.body); view.rerender(tree(false));
    expect(document.activeElement).toBe(document.body);
  });

  it('an externally prevented pointer that keeps Canvas focused cannot erase later owned-unmount focus restoration', () => {
    const { mount } = setup(900);
    const tree = (open: boolean) => <><div data-testid="outside-prevented" onPointerDown={event => event.preventDefault()}>external blank</div>
      {mount({ canvasOpen: open, canvasContent: open ? <input aria-label="canvas focus" /> : null })}</>;
    const view = render(tree(true)); const input = screen.getByLabelText('canvas focus'); input.focus();
    fireEvent.pointerDown(screen.getByTestId('outside-prevented')); fireEvent.pointerUp(screen.getByTestId('outside-prevented'));
    expect(input).toHaveFocus(); view.rerender(tree(false));
    expect(screen.getByRole('tab', { name: '任务' })).toHaveFocus();
  });

  it.each(['hidden', 'disabled', 'inert', 'focus-refused'] as const)('an external modal return target that becomes %s falls back to the surviving entry', state => {
    const { mount } = setup(899);
    function Fixture() {
      const [open, setOpen] = useState(false);
      return <><span data-testid="external-parent"><button type="button" onClick={() => setOpen(true)}>external open</button></span>
        {mount({ canvasOpen: open })}</>;
    }
    render(<Fixture />); const target = screen.getByRole('button', { name: 'external open' }); target.focus(); fireEvent.click(target);
    expect(screen.getByRole('dialog')).toBeVisible();
    if (state === 'hidden') target.hidden = true;
    if (state === 'disabled') target.setAttribute('disabled', '');
    if (state === 'inert') screen.getByTestId('external-parent').setAttribute('inert', '');
    if (state === 'focus-refused') vi.spyOn(target, 'focus').mockImplementation(() => {});
    const close = screen.getByRole('button', { name: '收起侧栏' }); close.focus(); fireEvent.click(close);
    expect(document.querySelector('.chat-right-entry')).toHaveFocus();
    expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
  });

  it.each(['escape', 'backdrop', 'entry'] as const)('explicit %s close still restores entry when the remembered external target is unavailable', via => {
    const { mount } = setup(899);
    function Fixture() { const [open, setOpen] = useState(false); return <><button type="button" onClick={() => setOpen(true)}>external open</button>{mount({ canvasOpen: open })}</>; }
    render(<Fixture />); const target = screen.getByRole('button', { name: 'external open' }); target.focus(); fireEvent.click(target); target.hidden = true;
    const close = screen.getByRole('button', { name: '收起侧栏' }); close.focus();
    if (via === 'escape') fireEvent.keyDown(close, { key: 'Escape' });
    else if (via === 'backdrop') {
      const backdrop = document.querySelector('.chat-right-backdrop')!; fireEvent.pointerDown(backdrop); close.blur(); fireEvent.pointerUp(backdrop); fireEvent.click(backdrop);
    } else { act(() => resize(900)); fireEvent.click(document.querySelector('.chat-right-entry')!); }
    expect(document.querySelector('.chat-right-entry')).toHaveFocus(); expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
  });

  it('the single Surface releases all document pointer-intent listeners on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
    const { mount } = setup(900); const view = render(mount());
    const owned = add.mock.calls.filter(([type, , capture]) => ['pointerdown', 'pointerup', 'pointercancel', 'keydown'].includes(type) && capture === true);
    expect(owned).toHaveLength(4); view.unmount();
    for (const [type, handler, capture] of owned) expect(remove).toHaveBeenCalledWith(type, handler, capture);
  });

  it.each(['click', 'keyboard', 'entry'] as const)('a retained Canvas selected through %s returns to its most recent non-Canvas selection, not the first external-open selection', via => {
    const { mount } = setup(900); const visible = vi.fn();
    const view = render(mount({ onCanvasVisibilityChange: visible }));
    view.rerender(mount({ canvasOpen: true, onCanvasVisibilityChange: visible }));
    fireEvent.click(screen.getByRole('tab', { name: 'SubAgent' }));
    // ChatShell binds this callback only to canvasVisible; canvasOpen and the
    // mounted Canvas content remain true when its tab is hidden.
    expect(visible).toHaveBeenLastCalledWith(false);
    if (via === 'entry') {
      fireEvent.click(screen.getByRole('tab', { name: '画布' }));
      fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
      view.rerender(mount({ canvasOpen: true, taskContent: null, hasAgentHistory: false, onCanvasVisibilityChange: visible }));
      fireEvent.click(document.querySelector('.chat-right-entry')!);
    } else if (via === 'keyboard') {
      const agents = screen.getByRole('tab', { name: 'SubAgent' }); agents.focus();
      fireEvent.keyDown(agents, { key: 'ArrowRight' });
    } else fireEvent.click(screen.getByRole('tab', { name: '画布' }));
    expect(screen.getByRole('tabpanel', { name: '画布' })).toBeVisible();
    view.rerender(mount({ canvasOpen: false, canvasContent: null, onCanvasVisibilityChange: visible }));
    if (via === 'entry') expect(screen.queryByRole('tabpanel')).toBeNull();
    else expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
  });

  it.each([899, 900])('Canvas entered from a user-collapsed surface at %s px returns closed and restores only lost owned focus to the surviving entry', width => {
    const { mount } = setup(width); const view = render(mount());
    if (width === 900) fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    view.rerender(mount({ canvasOpen: true }));
    screen.getByLabelText('canvas draft').focus();
    view.rerender(mount({ canvasOpen: false, canvasContent: null }));
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
    expect(document.querySelector('.chat-right-entry')).toHaveFocus();
    expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });

  it.each(['task', 'agents'] as const)('Canvas entered from %s restores that available view and its tab after the old Canvas focus is removed', previous => {
    const { mount } = setup(899); const view = render(mount({ agentCount: 1 }));
    fireEvent.click(document.querySelector('.chat-right-entry')!);
    fireEvent.click(screen.getByRole('tab', { name: previous === 'task' ? '任务' : 'SubAgent' }));
    view.rerender(mount({ agentCount: 1, canvasOpen: true }));
    screen.getByLabelText('canvas draft').focus();
    view.rerender(mount({ agentCount: 1, canvasOpen: false, canvasContent: null }));
    expect(screen.getByRole('tabpanel', { name: previous === 'task' ? '任务' : 'SubAgent' })).toBeVisible();
    expect(screen.getByRole('tab', { name: previous === 'task' ? '任务' : 'SubAgent' })).toHaveFocus();
    expect(screen.getByTestId('chat-right-main')).toHaveAttribute('inert');
  });

  it.each(['task', 'agents'] as const)('removing the remembered %s while Canvas is open uses the existing available-view fallback, not a stale tab', previous => {
    const { mount } = setup(900); const view = render(mount());
    fireEvent.click(screen.getByRole('tab', { name: previous === 'task' ? '任务' : 'SubAgent' }));
    view.rerender(mount({ canvasOpen: true }));
    const removed = previous === 'task' ? { taskContent: null } : { hasAgentHistory: false };
    view.rerender(mount({ canvasOpen: true, ...removed }));
    view.rerender(mount({ canvasOpen: false, canvasContent: null, ...removed }));
    expect(screen.getByRole('tabpanel', { name: previous === 'task' ? 'SubAgent' : '任务' })).toBeVisible();
  });

  it.each(['task', 'child'] as const)('first %s content arriving in the Canvas-closing commit cannot override a captured closed return target', first => {
    const { mount, props } = setup(900);
    const initial = { taskContent: null, canvasContent: null, hasAgentHistory: false };
    const view = render(mount(initial));
    view.rerender(mount({ ...initial, canvasOpen: true, canvasContent: props.canvasContent }));
    view.rerender(mount({ ...initial, ...(first === 'task' ? { taskContent: props.taskContent } : { agentCount: 1, hasAgentHistory: true }) }));
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(document.querySelector('.chat-right-entry')).not.toBeNull();
  });

  it('a wide Canvas close never steals existing external composer focus', () => {
    const { mount } = setup(900); const view = render(mount());
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    view.rerender(mount({ canvasOpen: true }));
    const composer = screen.getByLabelText('composer'); composer.focus();
    view.rerender(mount({ canvasOpen: false, canvasContent: null }));
    expect(composer).toHaveFocus(); expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
  });

  it('Canvas content disappearing while its open request remains true uses availability fallback without reselecting Canvas when content returns', () => {
    const { mount } = setup(900); const view = render(mount({ canvasOpen: true }));
    view.rerender(mount({ canvasOpen: true, canvasContent: null }));
    expect(screen.getByRole('tabpanel', { name: '任务' })).toBeVisible();
    view.rerender(mount({ canvasOpen: true }));
    expect(screen.getByRole('tabpanel', { name: '任务' })).toBeVisible();
  });

  it.each([[900, 899], [899, 900]])('Canvas close after resize from %s to %s uses that closing render width, not the opening effect closure', (from, to) => {
    const { mount } = setup(from); const view = render(mount({ canvasOpen: true, hasAgentHistory: false }));
    act(() => resize(to));
    expect(screen.getByRole('tabpanel', { name: '画布' })).toBeVisible();
    view.rerender(mount({ canvasOpen: false, canvasContent: null, hasAgentHistory: false }));
    if (to < 900) expect(screen.queryByRole('tabpanel')).toBeNull();
    else expect(screen.getByRole('tabpanel', { name: '任务' })).toBeVisible();
  });

  it.each([false, true])('Canvas close reads the latest Task availability=%s even though it changed while Canvas stayed open', available => {
    const { mount, props } = setup(900);
    const view = render(mount({ canvasOpen: true, hasAgentHistory: false, taskContent: available ? null : props.taskContent }));
    const latest = { canvasOpen: true, hasAgentHistory: false, taskContent: available ? props.taskContent : null };
    view.rerender(mount(latest));
    expect(screen.getByRole('tabpanel', { name: '画布' })).toBeVisible();
    view.rerender(mount({ ...latest, canvasOpen: false, canvasContent: null }));
    if (available) expect(screen.getByRole('tabpanel', { name: '任务' })).toBeVisible();
    else expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('U2 Given Canvas becomes selected, Then its visibility consumer is synchronized in the commit before another command can observe the rendered tab', () => {
    const { mount } = setup(); let visible = false; const observed: boolean[] = []; let observing = false;
    render(<Profiler id="surface" onRender={() => {
      if (observing && document.querySelector('[id$="canvas-tab"]')?.getAttribute('aria-selected') === 'true') observed.push(visible);
    }}>{mount({ onCanvasVisibilityChange: (value: boolean) => { visible = value; } })}</Profiler>);
    observing = true; fireEvent.click(screen.getByRole('tab', { name: '画布' }));
    expect(observed.length).toBeGreaterThan(0); expect(observed).not.toContain(false);
  });
  it('U4 Given native blur after hiding an owned drawer control, Then body-targeted Tab stays in the modal and unrelated body focus is not hijacked', () => {
    const { mount } = setup(899); render(mount({ agentCount: 1, agentsContent: <><button tabIndex={2}>first probe</button><button>last probe</button></> }));
    fireEvent.click(document.querySelector('.chat-right-entry')!);
    const tail = screen.getByRole('button', { name: 'last probe' }); tail.focus(); tail.hidden = true; tail.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab' }); expect(screen.getByRole('button', { name: 'first probe' })).toHaveFocus();
    screen.getByRole('button', { name: 'first probe' }).blur();
    fireEvent.keyDown(document.body, { key: 'Tab' }); expect(document.activeElement).toBe(document.body);
  });
  it('U1/U4 Given focus on the collapsed recovery entry, When recovery ends and the entry unmounts, Then focus returns without requiring an open panel', () => {
    const { mount } = setup(); const patch = { hasAgentHistory: false, taskContent: null, canvasContent: null };
    const view = render(mount({ ...patch, needsRecovery: true }));
    screen.getByRole('button', { name: '执行状态' }).focus();
    view.rerender(mount(patch));
    expect(document.querySelector('.chat-right-entry')).toBeNull();
    expect(screen.getByLabelText('composer')).toHaveFocus();
  });
  it('U1 Given a normal root-only chat with no history or recovery, Then no empty SubAgent entry or tab is rendered', () => {
    const { mount } = setup(); render(mount({ hasAgentHistory: false, taskContent: null, canvasContent: null }));
    expect(document.querySelector('.chat-right-entry')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'SubAgent', hidden: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });
  it.each(['task', 'canvas'] as const)('U1 Given only %s content, Then its existing entry has no child count or empty Agents tab', kind => {
    const { mount } = setup(899); render(mount({ hasAgentHistory: false,
      ...(kind === 'task' ? { canvasContent: null } : { taskContent: null }) }));
    const entry = document.querySelector('.chat-right-entry')!;
    expect(entry.textContent).toBe(kind === 'task' ? '任务' : '画布'); fireEvent.click(entry);
    expect(screen.queryByRole('tab', { name: 'SubAgent' })).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: kind === 'task' ? '任务' : '画布' })).toBeVisible();
  });
  it.each([false, true])('U1 Given only history with recovery=%s, Then only an actual recovery need retains an entrance under the new user requirement', needsRecovery => {
    const { mount } = setup(); render(mount({ needsRecovery, taskContent: null, canvasContent: null }));
    const entry = document.querySelector('.chat-right-entry');
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    if (needsRecovery) {
      expect(entry?.textContent).toBe('执行状态'); fireEvent.click(entry!);
      expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
      expect(document.querySelectorAll('.chat-right-entry')).toHaveLength(1);
    } else expect(entry).toBeNull();
  });
  it.each([899, 900])('U1/U4 Given root-only recovery at %s px, When the fault clears or the thread is deleted, Then the last entry disappears and owned focus returns to the composer', width => {
    const { mount } = setup(width); const patch = { hasAgentHistory: false, taskContent: null, canvasContent: null };
    const view = render(mount({ ...patch, needsRecovery: true }));
    fireEvent.click(screen.getByRole('button', { name: '执行状态' }));
    screen.getByRole('button', { name: 'child detail' }).focus();
    view.rerender(mount(patch));
    expect(document.querySelector('.chat-right-entry')).toBeNull(); expect(screen.getByLabelText('composer')).toHaveFocus();
    expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
    view.rerender(mount({ ...patch, needsRecovery: true, hasAgentHistory: true, agentCount: 1, deleted: true }));
    expect(document.querySelector('.chat-right-entry')).toBeNull();
  });
  it('U1 Given historical selection or same-thread reconnect after collapse, Then neither history rows nor new hydration reopen the surface', () => {
    const { mount } = setup(); const patch = { taskContent: null, canvasContent: null };
    const view = render(mount({ ...patch, agentCount: 3, historicalSelection: true, needsRecovery: true }));
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.chat-right-entry')!);
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    view.rerender(mount({ ...patch, agentCount: 0, historicalSelection: false }));
    view.rerender(mount({ ...patch, agentCount: 2, historicalSelection: false }));
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });
  it('U2 Given native disable blur leaves a connected owned tab unfocusable with body active, Then availability fallback restores focus to the selected tab', () => {
    const { mount } = setup(); const view = render(mount());
    const previous = screen.getByRole('tab', { name: '任务' }) as HTMLButtonElement;
    previous.focus(); previous.disabled = true; previous.blur();
    expect(previous.isConnected).toBe(true); expect(document.activeElement).toBe(document.body);
    view.rerender(mount({ taskContent: null }));
    expect(screen.getByRole('tab', { name: 'SubAgent' })).toHaveFocus();
  });
  it('U2 Given the real Canvas tabs are nested in the single surface, Then inner navigation stays inside Canvas and outer navigation never selects hidden inner tabs', () => {
    const { mount } = setup(); render(mount({ canvasOpen: true,
      canvasContent: <CanvasPanel events={[]} embedded onClose={() => {}} initialPreviewFile="preview.html" initialPreviewContent="preview" /> }));
    const panel = screen.getByTestId('chat-right-panel');
    const outer = within(panel.querySelector('.chat-right-tabs')!);
    const inner = within(panel.querySelector('.canvas-panel-tablist')!);
    fireEvent.click(inner.getByRole('tab', { name: '工具' }));
    fireEvent.keyDown(inner.getByRole('tab', { name: '工具' }), { key: 'Home' });
    expect(outer.getByRole('tab', { name: '画布' })).toHaveAttribute('aria-selected', 'true');
    expect(inner.getByRole('tab', { name: '预览' })).toHaveFocus();
    fireEvent.keyDown(inner.getByRole('tab', { name: '预览' }), { key: 'ArrowLeft' });
    expect(inner.getByRole('tab', { name: '工具' })).toHaveFocus();
    fireEvent.keyDown(inner.getByRole('tab', { name: '工具' }), { key: 'ArrowRight' });
    expect(inner.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(outer.getByRole('tab', { name: 'SubAgent' }));
    fireEvent.keyDown(outer.getByRole('tab', { name: 'SubAgent' }), { key: 'End' });
    expect(outer.getByRole('tab', { name: '画布' })).toHaveFocus();
    expect(inner.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(outer.getByRole('tab', { name: '画布' }), { key: 'ArrowRight' });
    expect(outer.getByRole('tab', { name: '任务' })).toHaveFocus();
    expect(screen.getByLabelText('preview draft')).toHaveValue('kept');
  });

  it('U2 Given roving top-level tabs, Then exactly the selected enabled tab participates in sequential focus and disabled views are skipped', () => {
    const { mount } = setup(); render(mount({ taskContent: null, agentCount: 1 }));
    const outer = within(screen.getByTestId('chat-right-panel').querySelector('.chat-right-tabs')!);
    expect(outer.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toEqual([outer.getByRole('tab', { name: 'SubAgent' })]);
    fireEvent.keyDown(outer.getByRole('tab', { name: 'SubAgent' }), { key: 'ArrowLeft' });
    expect(outer.getByRole('tab', { name: '画布' })).toHaveFocus();
    expect(outer.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toEqual([outer.getByRole('tab', { name: '画布' })]);
  });

  it.each(['tab', 'content', 'composer'] as const)('U2 Given focus in %s when the active Task view disappears, Then selection and inert normalize together without stealing external focus', focus => {
    const { mount } = setup(); const view = render(mount());
    const taskTab = screen.getByRole('tab', { name: '任务' });
    (focus === 'tab' ? taskTab : screen.getByLabelText(focus === 'content' ? 'task draft' : 'composer')).focus();
    view.rerender(mount({ taskContent: null }));
    const selected = screen.getByRole('tab', { name: 'SubAgent' });
    expect(selected).toHaveAttribute('aria-selected', 'true'); expect(selected).toHaveAttribute('tabindex', '0');
    expect(taskTab).toBeDisabled(); expect(taskTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).not.toHaveAttribute('inert');
    expect(focus === 'composer' ? screen.getByLabelText('composer') : selected).toHaveFocus();
    view.rerender(mount()); expect(selected).toHaveAttribute('aria-selected', 'true');
  });

  it('U4 Given a narrow drawer, Then explicit open focuses close and the real tab order handles positive tabindex, radio groups, hidden and inert controls', () => {
    const { mount } = setup(899); render(mount({ agentCount: 1, agentsContent: <>
      <button tabIndex={2}>positive</button><input type="radio" name="end" defaultChecked aria-label="checked radio" />
      <input type="radio" name="end" aria-label="unchecked radio" /><button hidden>hidden tail</button>
      <div inert><button>inert tail</button></div><button disabled>disabled tail</button>
    </> }));
    fireEvent.click(screen.getByRole('button', { name: /SubAgent.*1/ }));
    expect(screen.getByRole('button', { name: '收起侧栏' })).toHaveFocus();
    screen.getByLabelText('checked radio').focus(); fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'positive' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true }); expect(screen.getByLabelText('checked radio')).toHaveFocus();
    (screen.getByLabelText('checked radio') as HTMLInputElement).disabled = true;
    (screen.getByLabelText('unchecked radio') as HTMLInputElement).disabled = true;
    screen.getByRole('button', { name: '收起侧栏' }).focus(); fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'positive' })).toHaveFocus();
  });

  it.each(['before', 'middle', 'after'] as const)('U4 Given a visible programmatic focus %s the tabbable content across resize, Then it is retained but both Tab directions stay in the drawer', position => {
    const { mount } = setup(); const marker = <div tabIndex={-1} aria-label="programmatic preview">preview</div>;
    render(mount({ agentCount: 1, taskContent: null, agentsContent: <>
      {position === 'before' ? marker : null}<button>first leaf</button>{position === 'middle' ? marker : null}
      <a href="#leaf">last leaf</a>{position === 'after' ? marker : null}
    </> }));
    const preview = screen.getByLabelText('programmatic preview'); preview.focus(); act(() => resize(899)); expect(preview).toHaveFocus();
    fireEvent.keyDown(preview, { key: 'Tab' }); expect(screen.getByRole('tab', { name: 'SubAgent' })).toHaveFocus();
    preview.focus(); fireEvent.keyDown(preview, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('link', { name: 'last leaf' })).toHaveFocus();
    act(() => resize(900)); expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
    expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });

  it.each(['preventDefault', 'stopPropagation'] as const)('U4 Given a child consumes Escape with %s, Then one key never closes both layers or reaches the outer cancel handler', consumption => {
    const cancel = vi.fn(); const { mount } = setup(899);
    render(<div onKeyDown={event => { if (event.key === 'Escape') cancel(); }}>{mount({ agentCount: 1,
      agentsContent: <input aria-label="child popup" onKeyDown={event => { if (event.key === 'Escape') event[consumption](); }} /> })}</div>);
    const entry = screen.getByRole('button', { name: /SubAgent.*1/ }); fireEvent.click(entry);
    fireEvent.keyDown(screen.getByLabelText('child popup'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible(); expect(cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: '收起侧栏' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(entry).toHaveFocus(); expect(cancel).not.toHaveBeenCalled();
  });

  it('U1/U2 Given first child on a wide chat, Then Agents opens once without stealing focus, and manual collapse wins over later events', () => {
    const { mount } = setup(); const view = render(mount({ taskContent: null })); screen.getByLabelText('composer').focus();
    view.rerender(mount({ taskContent: null, agentCount: 1 }));
    expect(screen.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible(); expect(screen.getByLabelText('composer')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    view.rerender(mount({ taskContent: null, agentCount: 2 }));
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument(); expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });
  it('U2/U5 Given all three views, Then selecting tabs preserves drafts while only one panel is visible and expanded Canvas retains sixty percent', () => {
    const { mount } = setup(); render(mount({ canvasOpen: true, canvasExpanded: true }));
    expect(screen.getByTestId('chat-right-panel')).toHaveStyle({ width: '60%' });
    fireEvent.click(screen.getByRole('tab', { name: 'SubAgent' }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByTestId('chat-right-panel')).toHaveStyle({ width: '360px' });
    fireEvent.click(screen.getByRole('tab', { name: '画布' }));
    expect(screen.getByLabelText('canvas draft')).toHaveValue('canvas kept');
    expect(screen.getByLabelText('composer')).toHaveValue('unsent');
  });
  it('U4/U5 Given a narrow first spawn, Then only a badge appears; explicit open traps focus and Escape removes inert', () => {
    const { mount } = setup(899); const view = render(mount({ taskContent: null }));
    view.rerender(mount({ taskContent: null, agentCount: 1 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const entry = screen.getByRole('button', { name: /SubAgent.*1/ }); fireEvent.click(entry);
    expect(screen.getByRole('dialog')).toBeVisible(); expect(screen.getByTestId('chat-right-main')).toHaveAttribute('inert');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert'); expect(entry).toHaveFocus();
    fireEvent.click(entry); act(() => resize(900));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByTestId('chat-right-main')).not.toHaveAttribute('inert');
    expect(document.activeElement?.isConnected).toBe(true);
  });
});
