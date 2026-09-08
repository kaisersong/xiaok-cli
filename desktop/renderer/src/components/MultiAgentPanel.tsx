import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DesktopAgentSnapshot, DesktopMultiAgentGroup, MultiAgentControlResult, MultiAgentDesktopAPI, MultiAgentDurableEvent, MultiAgentPage } from '../../../shared/multi-agent-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MultiAgentConnection } from '../lib/multi-agent-connection';
import { readMultiAgentContent, type MultiAgentReadContent } from '../lib/multi-agent-content-reader';
import { buildAgentOutputView } from '../lib/multi-agent-output-view';
import { useLocale } from '../contexts/LocaleContext';
import { MultiAgentGroupControls } from './MultiAgentGroupControls';
import { SavedAgentContent } from './SavedAgentContent';
import { HostDeliveryStatus } from './HostDeliveryStatus';
import { MultiAgentApprovals } from './MultiAgentApprovals';
import { useLocalExecutionAuthorization } from '../hooks/useLocalExecutionAuthorization';
import type { HostDeliveryReport } from '../../../../src/runtime/task-host/delivery-types';
import './multi-agent-panel.css';

interface Props { connection: MultiAgentConnection; api: MultiAgentDesktopAPI; onSelectGroup: (groupId?: string) => void }
interface ReadIdentity {
  api: MultiAgentDesktopAPI; connection: MultiAgentConnection; threadId: string; groupId: string;
  agentId: string; turn: number; turnId?: string; contentId: string;
}
type ReadState = { identity: ReadIdentity; phase: 'loading' | 'error' } | { identity: ReadIdentity; phase: 'complete'; result: MultiAgentReadContent };
export function MultiAgentPanel({ connection, api, onSelectGroup }: Props) {
  const { t } = useLocale(); const labels = t.multiAgent;
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot); const view = state.projection;
  const executionAuthorization = useLocalExecutionAuthorization(api);
  const executionDenied = executionAuthorization.phase !== 'live' || !executionAuthorization.authorization
    || executionAuthorization.authorization.persistenceState !== 'confirmed' || !executionAuthorization.authorization.executionAllowed;
  const authorizationMessage = executionAuthorization.phase === 'loading' ? t.loading
    : executionAuthorization.phase !== 'live' || !executionAuthorization.authorization ? labels.authorization.unavailable
      : executionAuthorization.authorization.persistenceState === 'unknown' ? labels.authorization.unknown : labels.authorization.denied;
  const [selection, setSelection] = useState<string | null>(null); const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [commandBusy, setBusy] = useState(false); const [feedback, setFeedback] = useState<'sent' | 'queued' | 'unknown' | 'actionFailed' | null>(null);
  const [queuedReceipt, setQueuedReceipt] = useState<{ operationId: string; agentId: string; expectedTurn?: number } | null>(null);
  const [unknown, setUnknown] = useState<{ operationId: string; agentId: string; groupId: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false); const [agentCursor, setAgentCursor] = useState<string | null | undefined>();
  const historyScope = useMemo(() => ({ api, threadId: connection.threadId }), [api, connection.threadId]);
  const [history, setHistory] = useState<{ scope: typeof historyScope; page: MultiAgentPage<DesktopMultiAgentGroup> } | null>(null);
  const historyGeneration = useRef(0); const historyOwner = useRef(historyScope);
  const historyButton = useRef<HTMLButtonElement>(null); const moreGroupsButton = useRef<HTMLButtonElement>(null);
  const historyList = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ReadState | null>(null); const [now, setNow] = useState(Date.now);
  const activeRead = useRef<{ identity: ReadIdentity; controller: AbortController } | null>(null);
  const readOwner = useRef<ReadIdentity | null>(null);
  const agentRows = useRef(new Map<string, HTMLButtonElement>());
  const contentButton = useRef<HTMLButtonElement | null>(null); const restoreReadFocus = useRef(false);
  const onOwnedPagerRemoved = useCallback(() => { restoreReadFocus.current = true; }, []);
  const bindContentButton = useCallback((node: HTMLButtonElement | null) => {
    if (!node && contentButton.current === document.activeElement) restoreReadFocus.current = true;
    contentButton.current = node;
  }, []);
  const [announcement, setAnnouncement] = useState(''); const announcedFailures = useRef(new Set<string>()); const lastAnnouncement = useRef(0);
  const requestGeneration = useRef(0);
  const agents = view.agents;
  const displayName = (agent: DesktopAgentSnapshot) => agent.parentId === null ? labels.mainAgent
    : agent.presentationOrdinal ? labels.alias(agent.presentationOrdinal) || agent.taskName : agent.taskName;
  const displayStatus = (agent: DesktopAgentSnapshot) => agent.executionActive && agent.status === 'completed' ? labels.settling : labels.statuses[agent.status];
  const selected = agents.find(agent => agent.id === selection) ?? (view.root?.id === selection ? view.root : null) ?? agents[0] ?? view.root;
  const resourceStatus = !selected ? null : selected.cleanupPending ? labels.cleanupPending : selected.resourcesReleased ? labels.released
    : selected.stopState === 'requested' || selected.stopState === 'stalled' ? labels.stopped : selected.resumable ? labels.resident
      : selected.executionActive || selected.runtimeResident || selected.sessionResident ? labels.resourcesInUse : null;
  const draft = selected ? drafts[selected.id] ?? '' : '';
  const deleting = Boolean(view.snapshot?.threadDeleteState && view.snapshot.threadDeleteState !== 'none');
  const deleted = view.threadDeleteState === 'deleted';
  const groups = !deleted && history?.scope === historyScope ? history.page.items : null;
  const groupCursor = groups ? history!.page.nextCursor : null;
  const groupId = view.groupId; const scope = { threadId: connection.threadId, groupId: groupId! };
  const readIdentity = useMemo<ReadIdentity | null>(() => !deleted && groupId && selected?.resultContentId ? {
    api, connection, threadId: connection.threadId, groupId, agentId: selected.id,
    turn: selected.turn, turnId: selected.turnId, contentId: selected.resultContentId,
  } : null, [api, connection, connection.threadId, groupId, selected?.id, selected?.turn, selected?.turnId, selected?.resultContentId, deleted]);
  const currentRead = content?.identity === readIdentity ? content : null;
  const busy = commandBusy || currentRead?.phase === 'loading';
  const readonly = Boolean(deleting || view.snapshot?.group?.historicalOnly || view.snapshot?.group?.mutationBlockedReason || view.error || state.phase !== 'live');
  const controlsDisabled = readonly || busy || Boolean(unknown) || !selected || selected.status === 'closed';
  const abandonRead = () => { activeRead.current?.controller.abort(); activeRead.current = null; setContent(null); };
  useLayoutEffect(() => {
    readOwner.current = readIdentity; setContent(null);
    return () => { activeRead.current?.controller.abort(); activeRead.current = null; readOwner.current = null; };
  }, [readIdentity]);
  useLayoutEffect(() => {
    if (restoreReadFocus.current) { restoreReadFocus.current = false; if (selected?.id) agentRows.current.get(selected.id)?.focus(); }
  });
  useEffect(() => {
    requestGeneration.current++; setBusy(false); setSelection(null); setDrafts({}); setFeedback(null); setQueuedReceipt(null); setUnknown(null); setAgentCursor(undefined);
    return () => { requestGeneration.current++; };
  }, [connection, groupId]);
  // History belongs to the thread, not the selected group's connection. Scope
  // matching above hides old rows in the render which changes API or thread.
  useLayoutEffect(() => {
    historyOwner.current = historyScope; historyGeneration.current++; setHistory(null);
    return () => { historyGeneration.current++; };
  }, [historyScope, deleted]);
  useEffect(() => { if (!selection && selected) setSelection(selected.id); }, [selection, selected]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const failure = agents.find(agent => agent.status === 'failed' && !announcedFailures.current.has(`${agent.id}:${agent.turn}`));
    if (failure) { announcedFailures.current.add(`${failure.id}:${failure.turn}`); setAnnouncement(labels.failureAnnouncement(displayName(failure))); return; }
    if (now - lastAnnouncement.current < 10_000) return;
    lastAnnouncement.current = now;
    setAnnouncement(view.pendingApprovalCount > 0 ? labels.approvals.pending(view.pendingApprovalCount)
      : labels.activityAnnouncement(agents.filter(agent => agent.status === 'running').length, agents.filter(agent => agent.status === 'completed').length));
  }, [agents, now, labels, view.pendingApprovalCount]);
  const applyFeedback = (result: MultiAgentControlResult, operationId: string, agentId: string, submitted: string) => {
    setQueuedReceipt(result.state === 'queued_next_admission' ? { operationId, agentId: result.targetAgentId ?? agentId,
      expectedTurn: result.expectedTurn } : null);
    if (result.state === 'unknown') { setUnknown({ operationId, agentId, groupId: groupId! }); setFeedback('unknown'); return; }
    if (result.outcome === 'cancelled' || result.outcome === 'rejected') { setUnknown(null); setFeedback('actionFailed'); connection.refresh(); return; }
    setFeedback(result.state === 'queued_next_admission' ? 'queued' : 'sent'); setUnknown(null);
    if (submitted) setDrafts(previous => previous[agentId] === submitted ? { ...previous, [agentId]: '' } : previous);
    connection.refresh();
  };
  const command = async (kind: 'sendAgentMessage' | 'followupAgent' | 'interruptAgent' | 'closeAgent') => {
    if (!selected || !groupId || controlsDisabled) return;
    if (executionDenied && (kind === 'sendAgentMessage' || kind === 'followupAgent')) return;
    const generation = requestGeneration.current; const agentId = selected.id; const submitted = draft; const operationId = crypto.randomUUID();
    setBusy(true); setFeedback(null); setConfirmClose(false);
    try {
      const input = { ...scope, agentId, operationId, expectedTurn: selected.turn, message: submitted };
      const result = kind === 'sendAgentMessage' || kind === 'followupAgent'
        ? await api[kind](input)
        : await api[kind]({ ...scope, agentId, operationId, expectedTurn: selected.turn });
      if (generation === requestGeneration.current) applyFeedback(result, operationId, agentId, kind === 'sendAgentMessage' || kind === 'followupAgent' ? submitted : '');
    } catch {
      // A transport failure can happen after apply. Query the stable operation ID
      // rather than allocating another mutation automatically.
      if (generation === requestGeneration.current) { setUnknown({ operationId, agentId, groupId }); setFeedback('unknown'); }
    } finally { if (generation === requestGeneration.current) setBusy(false); }
  };
  const checkOperation = async () => {
    if (!unknown || busy) return; setBusy(true); const generation = requestGeneration.current;
    try {
      const operation = await api.getMultiAgentOperation({ threadId: connection.threadId, groupId: unknown.groupId, operationId: unknown.operationId });
      if (generation !== requestGeneration.current) return;
      if (operation?.applyState === 'applied' && operation.result.state !== 'unknown') {
        applyFeedback(operation.result as unknown as MultiAgentControlResult, unknown.operationId, unknown.agentId, '');
      }
    } catch { /* Keep unknown and the exact operation ID for another read. */ }
    finally { if (generation === requestGeneration.current) setBusy(false); }
  };
  const readGroups = async (cursor?: string) => {
    if (deleted) return;
    const generation = ++historyGeneration.current;
    try { const page = await api.listMultiAgentGroups({ threadId: connection.threadId, cursor });
      if (generation !== historyGeneration.current || historyOwner.current !== historyScope) return;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusedGroup = focused && historyList.current?.contains(focused) ? focused.dataset.historyGroupId : undefined;
      if (focused && (focused === moreGroupsButton.current && !page.nextCursor || focusedGroup && !page.items.some(group => group.groupId === focusedGroup))) historyButton.current?.focus();
      setHistory({ scope: historyScope, page });
    } catch { if (generation === historyGeneration.current && historyOwner.current === historyScope) setFeedback('actionFailed'); }
  };
  const readAgents = async () => {
    const cursor = agentCursor === undefined ? view.snapshot?.nextAgentCursor : agentCursor; if (!groupId || !cursor) return;
    const generation = requestGeneration.current;
    const request = connection.beginAgentPage(cursor); if (!request) return;
    try { const page = await api.listMultiAgents({ ...scope, cursor });
      if (generation === requestGeneration.current && connection.installAgentPage(page.items, request)) setAgentCursor(page.nextCursor);
    } catch { if (generation === requestGeneration.current) setFeedback('actionFailed'); }
  };
  const readContent = async () => {
    if (!readIdentity || busy || readOwner.current !== readIdentity) return;
    const identity = readIdentity; const session = { identity, controller: new AbortController() };
    activeRead.current?.controller.abort(); activeRead.current = session;
    const isCurrent = () => {
      if (activeRead.current !== session || readOwner.current !== identity || session.controller.signal.aborted) return false;
      const latest = identity.connection.getSnapshot().projection;
      const latestAgent = latest.root?.id === identity.agentId ? latest.root : latest.agents.find(item => item.id === identity.agentId);
      return latest.threadId === identity.threadId && latest.groupId === identity.groupId && latest.threadDeleteState !== 'deleted'
        && latestAgent?.turn === identity.turn && latestAgent?.turnId === identity.turnId && latestAgent?.resultContentId === identity.contentId;
    };
    setContent({ identity, phase: 'loading' });
    try {
      const result = await readMultiAgentContent(identity.api, { threadId: identity.threadId, groupId: identity.groupId, contentId: identity.contentId }, {
        signal: session.controller.signal, assertCurrent: () => { if (!isCurrent()) throw new DOMException('Read no longer selected', 'AbortError'); },
      });
      if (isCurrent()) setContent({ identity, phase: 'complete', result });
    } catch { if (isCurrent()) setContent({ identity, phase: 'error' }); }
    finally { if (activeRead.current === session) activeRead.current = null; }
  };
  const outputView = useMemo(() => selected ? buildAgentOutputView({ groupId, agent: selected,
    details: (agentId, beforeSeq) => connection.details(agentId, beforeSeq), userSender: labels.userSender }) : { entries: [], partial: false },
  [connection, view, selected, groupId, labels.userSender]);
  return <div className="multi-agent-panel">
    <div className="multi-agent-toolbar">
      <button ref={historyButton} type="button" onClick={() => {
        if (groups) { historyGeneration.current++; setHistory(null); } else void readGroups();
      }}>{labels.history}</button>
      <button type="button" onClick={() => connection.refresh()}>{labels.retry}</button>
    </div>
    <MultiAgentGroupControls api={api} threadId={connection.threadId} groupId={groupId} activeGroupId={view.snapshot?.activeGroupId ?? null}
      executionDenied={executionDenied}
      historical={Boolean(view.snapshot?.group?.historicalOnly)} ready={state.phase === 'live'} blocked={Boolean(view.snapshot?.runtimeError)}
      deletionPending={deleting} resetPending={view.snapshot?.group?.mutationBlockedReason === 'group_reset_pending'} onChanged={() => connection.refresh()} />
    {groups ? <div ref={historyList} className="multi-agent-history">
      <button type="button" onClick={() => onSelectGroup(undefined)}>{labels.currentGroup}</button>
      {groups.map(group => <button type="button" key={group.groupId} data-history-group-id={group.groupId} onClick={() => onSelectGroup(group.groupId)}>{new Date(group.createdAt).toLocaleString()} · {group.groupId.slice(0, 8)}</button>)}
      {groupCursor ? <button ref={moreGroupsButton} type="button" onClick={() => void readGroups(groupCursor)}>{labels.moreGroups}</button> : null}
    </div> : null}
    {state.phase === 'loading' ? <p role="status">{labels.loading}</p> : null}
    {state.error ? <p role="alert">{labels.unavailable}<br />{state.error.includes('blocked') ? labels.blocked : <code>{state.error}</code>}</p> : null}
    {view.snapshot?.group?.historicalOnly ? <p className="multi-agent-note">{labels.historical}</p> : null}
    {executionDenied && <div className="multi-agent-note"><p>{authorizationMessage}</p>
      <button type="button" onClick={() => window.dispatchEvent(new Event('xiaok:app:open-settings'))}>{labels.authorization.openSettings}</button></div>}
    {view.approvalFailure && <p role="alert">{labels.approvals.failure}</p>}
    {view.snapshot?.group?.historicalOnly && view.pendingApprovalCount > 0 && <p>{labels.approvals.currentPending(view.pendingApprovalCount)} <button type="button" onClick={() => onSelectGroup(undefined)}>{labels.currentGroup}</button></p>}
    {!deleted && view.snapshot?.group && <MultiAgentApprovals api={api} connection={connection} threadId={connection.threadId} groupId={view.snapshot.group.groupId}
      bootId={view.snapshot.group.bootId} pending={view.snapshot.pendingApprovals ?? []} agents={[...(view.root ? [view.root] : []), ...agents]}
      readonly={readonly || executionDenied || view.approvalFailure?.groupId === groupId} now={now} />}
    {deleting ? <p role="status">{t.deleteThreadPending}</p> : null}
    {!agents.length && !view.pendingApprovalCount && state.phase === 'live' ? <p className="multi-agent-empty">{labels.empty}</p> : null}
    <div className="multi-agent-tree" role="list">
      {[...(view.root ? [view.root] : []), ...agents].map(agent => <div role="listitem" key={agent.id}>
        <button ref={node => { if (node) agentRows.current.set(agent.id, node); else agentRows.current.delete(agent.id); }} type="button" aria-pressed={selected?.id === agent.id} aria-label={`${displayName(agent)} ${displayStatus(agent)}`} className="multi-agent-row" onClick={() => { abandonRead(); setSelection(agent.id); setConfirmClose(false); }}>
          <span className={`multi-agent-dot multi-agent-dot--${agent.status}`} aria-hidden="true" />
          {agent.parentId === null ? <span className="multi-agent-name">{displayName(agent)}</span> : <em className="multi-agent-name multi-agent-alias">{displayName(agent)}</em>}
          <span className="multi-agent-status">{displayStatus(agent)}</span>
        </button>
      </div>)}
    </div>
    {(agentCursor === undefined ? view.snapshot?.nextAgentCursor : agentCursor) ? <button type="button" onClick={() => void readAgents()}>{labels.moreAgents}</button> : null}
    {selected ? <section className="multi-agent-detail" aria-label={displayName(selected)}>
      {selected.taskSummary ? <p className="multi-agent-assignment">{labels.assignment(selected.taskSummary)}</p> : null}
      <div className="multi-agent-meta">
        <code>{selected.id}</code>
        <span>{labels.turnLabel(selected.turn)}</span>
        {selected.phase && selected.executionActive && selected.status === 'running' ? <span>{labels.phases[selected.phase] ?? labels.statuses[selected.status]}{selected.currentTool ? ` · ${selected.currentTool}` : ''}</span> : null}
        {selected.startedAt ? <span>{labels.elapsed(Math.max(0, Math.floor(((selected.executionActive ? now : selected.endedAt ?? now) - selected.startedAt) / 1000)))}</span> : null}
        {selected.parentId !== null ? <span>{selected.toolsCompleted === undefined ? labels.toolsUnrecorded
          : selected.executionActive ? labels.toolsRecorded(selected.toolsCompleted)
            : selected.toolStatisticsComplete ? labels.toolSummary(selected.toolsCompleted, selected.toolsFailed ?? 0) : labels.toolsIncomplete}</span> : null}
        {selected.toolCounts && (selected.executionActive || selected.toolStatisticsComplete) ? <span>{[
          ...Object.entries(selected.toolCounts).map(([name, count]) => `${name} ${count}`),
          ...(selected.otherToolCount ? [labels.otherTools(selected.otherToolCount)] : []),
        ].join(' / ')}</span> : null}
        {selected.usage ? <span>{labels.usage(selected.usage.inputTokens, selected.usage.outputTokens)}</span> : null}
        {resourceStatus ? <span>{resourceStatus}</span> : null}
        {selected.unreadMessages ? <span>{labels.unread(selected.unreadMessages)}</span> : null}
        {selected.error || selected.cleanupError ? <p role="alert">{selected.error ?? selected.cleanupError}</p> : null}
      </div>
      <div className="multi-agent-output" data-testid="multi-agent-output">
        {selected.parentId === null ? <HostDeliveryStatus status={selected.hostDeliveryStatus} guardFailure={selected.guardFailure}
          cleanupPending={selected.hostDeliveryCleanupPending} executionStatus={selected.status} /> : null}
        {outputView.partial ? <small>{labels.previewTruncated}</small> : null}
        {outputView.entries.map(item => <div key={item.key} className={item.event ? 'multi-agent-event' : undefined}>
          {item.kind === 'delivery' && item.event ? <DeliveryHistory event={item.event} /> : <>
            {item.event ? <small>{labels.eventKinds[item.event.kind]}</small> : null}
            {item.kind === 'message_sent' || item.kind === 'artifact' ? <pre>{item.text}</pre> : <AgentOutputMarkdown content={item.text} />}
          </>}
          {item.partial ? <small>{labels.previewTruncated}</small> : null}
        </div>)}
        {readIdentity ? <button ref={bindContentButton} type="button" aria-disabled={busy} onClick={() => void readContent()}>{labels.loadContent}</button> : null}
        {currentRead?.phase === 'loading' ? <p role="status">{labels.contentLoading}</p> : null}
        {currentRead?.phase === 'error' ? <p role="alert">{labels.contentReadFailed}</p> : null}
        {currentRead?.phase === 'complete' ? <SavedAgentContent result={currentRead.result} labels={labels} onOwnedPagerRemoved={onOwnedPagerRemoved} /> : null}
      </div>
      <label className="multi-agent-composer">{labels.message}<textarea value={draft} maxLength={16 * 1024} disabled={readonly}
        onChange={event => setDrafts(previous => ({ ...previous, [selected.id]: event.target.value }))} /></label>
      <div className="multi-agent-actions">
        <button type="button" disabled={controlsDisabled || executionDenied || !draft.trim() || new TextEncoder().encode(draft).byteLength > 16 * 1024} onClick={() => void command('sendAgentMessage')}>{labels.send}</button>
        <button type="button" disabled={controlsDisabled || executionDenied || !selected.parentId || !selected.resumable || !draft.trim() || new TextEncoder().encode(draft).byteLength > 16 * 1024} onClick={() => void command('followupAgent')}>{labels.followup}</button>
        <button type="button" disabled={controlsDisabled || !selected.parentId || !selected.executionActive} onClick={() => void command('interruptAgent')}>{labels.interrupt}</button>
        <button type="button" disabled={controlsDisabled || !selected.parentId || selected.cleanupPending} onClick={() => setConfirmClose(true)}>{labels.closeAgent}</button>
      </div>
      {confirmClose ? <div className="multi-agent-confirm"><p>{labels.confirmClose}</p><button type="button" onClick={() => void command('closeAgent')}>{labels.closeAgent}</button><button type="button" onClick={() => setConfirmClose(false)}>{labels.cancel}</button></div> : null}
    </section> : null}
    {feedback ? <p role="status">{feedback === 'queued' && queuedReceipt ? labels.queuedReceipt(queuedReceipt.agentId, queuedReceipt.expectedTurn) : labels[feedback]}</p> : null}
    {unknown ? <button type="button" disabled={busy} onClick={() => void checkOperation()}>{labels.checkOperation}</button> : null}
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </div>;
}

/** Historical source facts are read-only and cannot select or dispatch a turn. */
function DeliveryHistory({ event }: { event: MultiAgentDurableEvent }) {
  const { t } = useLocale(); const { source, delivery } = event.payload as unknown as HostDeliveryReport;
  if (!source || !delivery) return null;
  return <details><summary>{t.multiAgent.deliveryHistory(source.sourceTaskId)}</summary>
    <HostDeliveryStatus status={delivery.status} guardFailure={delivery.guardFailure}
      cleanupPending={delivery.readerCleanup === 'pending' || delivery.storeCleanup === 'pending'} />
  </details>;
}

const OUTPUT_REMARK_PLUGINS = [remarkGfm];
/** Formatting only: this formerly plain-text surface gains no external effects. */
function AgentOutputMarkdown({ content }: { content: string }) {
  return <div className="prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={OUTPUT_REMARK_PLUGINS} skipHtml components={{
    a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className="overflow-x-auto my-3"><table className="min-w-full border-collapse border border-[var(--c-border)] text-sm">{children}</table></div>,
    th: ({ children }) => <th className="border border-[var(--c-border)] px-3 py-2 text-left">{children}</th>,
    td: ({ children }) => <td className="border border-[var(--c-border)] px-3 py-2">{children}</td>,
  }}>{content}</ReactMarkdown></div>;
}
