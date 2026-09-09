import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { isFocusable, tabbable, type FocusableElement } from 'tabbable';
import { useLocale } from '../contexts/LocaleContext';
import './chat-right-surface.css';

type View = 'task' | 'agents' | 'files' | 'instructions' | 'canvas';
const views = ['task', 'agents', 'files', 'instructions', 'canvas'] as const;
interface Props {
  threadId: string; agentCount: number; taskContent?: ReactNode; agentsContent: ReactNode; canvasContent?: ReactNode;
  filesContent?: ReactNode; instructionsContent?: ReactNode;
  viewRequest?: { view: 'task' | 'files' | 'instructions'; requestId: number };
  hasAgentHistory?: boolean; needsRecovery?: boolean; historicalSelection?: boolean; deleted?: boolean;
  pendingApprovalCount?: number;
  canvasOpen: boolean; canvasRequestId: number; canvasExpanded: boolean; children: ReactNode;
  onCanvasVisibilityChange?: (visible: boolean) => void;
}
export function ChatRightSurface(props: Props) {
  const { t } = useLocale(); const labels = t.multiAgent;
  const outer = useRef<HTMLDivElement>(null); const main = useRef<HTMLDivElement>(null); const panel = useRef<HTMLElement>(null);
  const entry = useRef<HTMLButtonElement>(null); const returnFocus = useRef<HTMLElement | null>(null);
  const tablist = useRef<HTMLDivElement>(null); const closeButton = useRef<HTMLButtonElement>(null);
  const focusedWithin = useRef<HTMLElement | null>(null);
  const externalPointer = useRef<{ event: PointerEvent; from: HTMLElement } | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [requestedView, setActive] = useState<View | null>(props.canvasOpen ? 'canvas' : null);
  const previousNonCanvas = useRef<View | null | undefined>(undefined);
  const narrow = width === null || width < 900;
  const pending = props.deleted ? 0 : props.pendingApprovalCount ?? 0;
  const available = { task: Boolean(props.taskContent), agents: !props.deleted && Boolean(props.agentCount || props.hasAgentHistory || props.needsRecovery || pending), files: Boolean(props.filesContent), instructions: Boolean(props.instructionsContent), canvas: Boolean(props.canvasContent) };
  const fallback = views.find(view => available[view]) ?? null;
  // Null remembers an explicitly closed surface; only an absent return record
  // uses the initial wide-screen Task default. Resolve the closing target before
  // availability normalization can replace the Canvas request with another tab.
  const canvasReturn = previousNonCanvas.current === undefined ? (!narrow && props.taskContent ? 'task' : null) : previousNonCanvas.current;
  const closingCanvas = requestedView === 'canvas' && !props.canvasOpen && !available.canvas;
  const desiredView = closingCanvas ? canvasReturn : requestedView;
  const active = desiredView && !available[desiredView] ? fallback : desiredView;
  const seenChild = useRef(false); const interacted = useRef(false); const initialTask = useRef(false);
  const modal = width !== null && narrow && active !== null;
  const recoveryOnly = !props.agentCount && !props.hasAgentHistory && (props.needsRecovery || pending > 0);
  const names = { task: labels.taskTab, agents: recoveryOnly ? labels.executionState : labels.agentsTab, files: t.roomWorkspace.filesTab, instructions: t.roomWorkspace.instructionsTab, canvas: labels.canvasTab };
  // History keeps its readable tab, but never creates a standalone capsule.
  // Counts from a selected historical group are not current execution facts.
  const currentChildren = !props.historicalSelection && props.agentCount > 0;
  const agentsEntry = !props.deleted && (currentChildren || props.needsRecovery || pending > 0);
  const contentEntry = available.task ? 'task' : available.files ? 'files' : available.instructions ? 'instructions' : available.canvas ? 'canvas' : null;
  const entryView = active && (active !== 'agents' || agentsEntry) ? active : agentsEntry ? 'agents' : contentEntry;
  const entryLabel = entryView ? labels.openPanel(entryView === 'agents' && !currentChildren ? labels.executionState : names[entryView],
    entryView === 'agents' && currentChildren ? props.agentCount : 0) : '';
  useLayoutEffect(() => {
    const node = outer.current; if (!node) return;
    if (typeof ResizeObserver === 'undefined') { setWidth(window.innerWidth); return; }
    const observer = new ResizeObserver(entries => { if (entries[0]) setWidth(entries[0].contentRect.width); });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const clear = () => { externalPointer.current = null; };
    const notePointer = (event: PointerEvent) => {
      clear(); const target = event.target; const from = focusedWithin.current;
      if (!from || !(target instanceof Node) || panel.current?.contains(target) || entry.current?.contains(target)) return;
      // The backdrop is an explicit close control, not a transfer of focus
      // ownership to unrelated outside content.
      if (target instanceof Element && target.closest('.chat-right-backdrop')?.parentElement === outer.current) return;
      externalPointer.current = { event, from };
    };
    document.addEventListener('pointerdown', notePointer, true);
    document.addEventListener('pointerup', clear, true);
    document.addEventListener('pointercancel', clear, true);
    document.addEventListener('keydown', clear, true);
    return () => {
      clear(); document.removeEventListener('pointerdown', notePointer, true);
      document.removeEventListener('pointerup', clear, true);
      document.removeEventListener('pointercancel', clear, true);
      document.removeEventListener('keydown', clear, true);
    };
  }, []);
  const trackBlur = (event: FocusEvent<HTMLElement>) => {
    const pointer = externalPointer.current;
    if (event.relatedTarget && !panel.current?.contains(event.relatedTarget as Node)
      || !event.relatedTarget && pointer?.from === event.target && !pointer.event.defaultPrevented) focusedWithin.current = null;
    externalPointer.current = null;
  };
  useEffect(() => {
    if (props.canvasOpen) setActive(previous => { if (previous !== 'canvas') previousNonCanvas.current = previous; return 'canvas'; });
    else setActive(previous => previous === 'canvas' ? canvasReturn : previous);
  }, [props.canvasOpen, props.canvasRequestId]);
  useEffect(() => {
    if (width === null || initialTask.current || !props.taskContent) return;
    initialTask.current = true;
    if (!closingCanvas && !narrow && props.taskContent && !props.canvasOpen && !interacted.current && !seenChild.current) setActive('task');
  }, [width, narrow, props.taskContent, props.canvasOpen, closingCanvas]);
  useEffect(() => {
    if (!available.agents || props.historicalSelection || !props.agentCount || seenChild.current || width === null) return;
    seenChild.current = true;
    if (!closingCanvas && !narrow && !props.canvasOpen && !interacted.current && !panel.current?.contains(document.activeElement)) setActive('agents');
  }, [props.agentCount, props.canvasOpen, props.historicalSelection, available.agents, narrow, width, closingCanvas]);
  useLayoutEffect(() => { props.onCanvasVisibilityChange?.(active === 'canvas'); }, [active, props.onCanvasVisibilityChange]);
  useLayoutEffect(() => {
    if (requestedView === active && entryView !== null) return;
    const current = document.activeElement;
    const lostOwnedFocus = focusedWithin.current && (
      current instanceof HTMLElement && panel.current?.contains(current) && !isFocusable(current)
      || current === document.body && (!focusedWithin.current.isConnected || !isFocusable(focusedWithin.current)));
    setActive(active);
    if (lostOwnedFocus) {
      if (active) tablist.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
      else {
        if (main.current) main.current.inert = false;
        const target = main.current && tabbable(main.current).find(node => node.matches('textarea, input, [contenteditable="true"]'));
        (closingCanvas && entryView ? entry.current : target || main.current)?.focus();
      }
    }
  }, [requestedView, active, entryView]);
  useLayoutEffect(() => {
    const node = main.current;
    if (!modal || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = previous;
    node.inert = true;
    if (!previous || !panel.current?.contains(previous) || !isFocusable(previous)) closeButton.current?.focus();
    const recoverBodyFocus = (event: KeyboardEvent) => {
      const owned = focusedWithin.current;
      if (event.target === document.body && owned && owned !== entry.current
        && (!owned.isConnected || panel.current?.contains(owned) && !isFocusable(owned))) onKeys(event);
    };
    document.addEventListener('keydown', recoverBodyFocus);
    return () => { node.inert = false; document.removeEventListener('keydown', recoverBodyFocus); };
  }, [modal]);
  const close = () => {
    interacted.current = true; setActive(null);
    const target = returnFocus.current;
    const focus = (node: FocusableElement | null | undefined) => {
      if (!node?.isConnected || !isFocusable(node)) return false;
      node.focus(); return document.activeElement === node;
    };
    // The entry remains mounted in both responsive modes.
    if (target && target.tabIndex >= 0 && !panel.current?.contains(target) && !main.current?.contains(target) && focus(target)) return;
    if (focus(entry.current)) return;
    if (main.current) {
      main.current.inert = false;
      const composer = tabbable(main.current).find(node => node.matches('textarea, input, [contenteditable="true"]'));
      if (!focus(composer)) focus(main.current);
    }
  };
  const select = (view: View) => {
    interacted.current = true;
    if (view === 'canvas' && active !== 'canvas') previousNonCanvas.current = active;
    setActive(view);
  };
  useEffect(() => {
    if (props.viewRequest) { interacted.current = true; setActive(props.viewRequest.view); }
  }, [props.viewRequest?.requestId]);
  function onKeys(event: Pick<KeyboardEvent, 'defaultPrevented' | 'key' | 'target' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>) {
    if (event.defaultPrevented) { if (event.key === 'Escape') event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.target instanceof HTMLButtonElement && event.target.getAttribute('role') === 'tab'
      && event.target.closest('[role="tablist"]') === tablist.current
      && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = [...(tablist.current?.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]:not(:disabled)') ?? [])];
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || !tabs.length) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); event.stopPropagation(); tabs[next]?.focus(); tabs[next]?.click(); return;
    }
    if (!modal || event.key !== 'Tab' || !panel.current) return;
    const controls = tabbable(panel.current);
    const first = controls[0] ?? closeButton.current; const last = controls.at(-1) ?? closeButton.current;
    const outsideOrder = !controls.includes(document.activeElement as HTMLElement);
    if (outsideOrder || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
      event.preventDefault(); event.stopPropagation(); (event.shiftKey ? last : first)?.focus();
    }
  };
  return <div ref={outer} className="chat-right-layout" data-thread-id={props.threadId}>
    <div ref={main} className="chat-right-main" data-testid="chat-right-main" inert={modal} tabIndex={-1}>{props.children}</div>
    {entryView ? <button ref={entry} type="button" className="chat-right-entry" aria-expanded={active !== null}
      onFocus={event => { focusedWithin.current = event.currentTarget; }}
      onBlur={trackBlur}
      onClick={() => active ? close() : select(entryView)}>{entryLabel}{active === null && pending > 0 ? <span> · {labels.approvals.pending(pending)}</span> : null}</button> : null}
    {modal ? <div className="chat-right-backdrop" aria-hidden="true" onClick={close} /> : null}
    <section ref={panel} className={`chat-right-panel${modal ? ' chat-right-panel--drawer' : ''}`} hidden={active === null}
      data-testid="chat-right-panel" role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={names[active ?? 'agents']}
      style={!narrow && active === 'canvas' && props.canvasExpanded ? { width: '60%', minWidth: 500, maxWidth: '70%' } : { width: 360 }} onKeyDown={onKeys}
      onFocusCapture={event => { focusedWithin.current = event.target as HTMLElement; }}
      onBlurCapture={trackBlur}>
      <div ref={tablist} className="chat-right-tabs" role="tablist">
        {views.filter(view => !['agents', 'files', 'instructions'].includes(view) || available[view]).map(view => <button key={view} type="button" role="tab" id={`right-${props.threadId}-${view}-tab`}
          aria-controls={`right-${props.threadId}-${view}`} aria-selected={active === view} disabled={!available[view]} tabIndex={active === view ? 0 : -1}
          onClick={() => select(view)}>{names[view]}{view === 'agents' && pending > 0 ? <span aria-label={labels.approvals.pending(pending)}> · {pending}</span> : null}</button>)}
        <button ref={closeButton} type="button" className="chat-right-close" aria-label={labels.closePanel} onClick={close}>×</button>
      </div>
      {views.map(view => <div key={view} role="tabpanel" id={`right-${props.threadId}-${view}`}
        aria-labelledby={`right-${props.threadId}-${view}-tab`} className="chat-right-body" hidden={active !== view} inert={active !== view}>
        {view === 'task' ? props.taskContent : view === 'agents' ? props.agentsContent : view === 'files' ? props.filesContent : view === 'instructions' ? props.instructionsContent : props.canvasContent}
      </div>)}
    </section>
  </div>;
}
