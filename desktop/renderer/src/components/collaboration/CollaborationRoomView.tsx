import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, FolderPlus, RefreshCw, Send, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import { desktop, type RoomUiSnapshot } from '../../lib/desktop';

export interface CollaborationRoomViewProps {
  roomId: string;
  degradedProjects?: Array<{ id: string; name: string }>;
  availableAgents?: Array<{ id: string; name: string }>;
}

type ViewState = 'loading' | 'error' | 'degraded' | 'ready';

export function CollaborationRoomView({ roomId, degradedProjects, availableAgents = [] }: CollaborationRoomViewProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<RoomUiSnapshot | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [text, setText] = useState('');
  const [policy, setPolicy] = useState<'none' | 'mentioned' | 'team_once'>('none');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [showProject, setShowProject] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectGoal, setProjectGoal] = useState('');
  const [projectPo, setProjectPo] = useState('');
  const [projectMembers, setProjectMembers] = useState<string[]>([]);
  const [memberSelection, setMemberSelection] = useState<string[]>([]);

  const load = useCallback(async () => {
    setViewState('loading');
    try {
      const result = await desktop.getCollaborationRoom(roomId);
      setSnapshot(result);
      setViewState(result.ok ? 'ready' : result.degraded ? 'degraded' : 'error');
      const lastSequence = Math.max(0, ...(result.messages ?? []).map((message) => message.roomSequence ?? 0));
      if (result.ok && lastSequence > 0) {
        void desktop.markCollaborationRoomSeen({ roomId, lastSeenRoomSequence: lastSequence });
      }
    } catch {
      setViewState('error');
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  const activeAgentIds = useMemo(() => (snapshot?.members ?? [])
    .filter((member) => member.status === 'active' && member.subject.kind === 'agent')
    .map((member) => member.subject.kind === 'agent' ? member.subject.logicalAgentId : ''), [snapshot]);

  useEffect(() => { setMemberSelection(activeAgentIds); }, [activeAgentIds.join('|')]);

  const sendMessage = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setActionError(null);
    const mentions = availableAgents
      .filter((agent) => text.includes(`@${agent.id}`))
      .map((agent) => ({ kind: 'agent', logicalAgentId: agent.id }));
    try {
      const result = await desktop.sendCollaborationRoomMessage({
        roomId,
        text: text.trim(),
        mentions,
        responsePolicy: mentions.length > 0 && policy === 'none'
          ? 'mentioned'
          : (policy === 'mentioned' && mentions.length === 0 ? 'none' : policy),
        idempotencyKey: crypto.randomUUID(),
      }) as { ok?: boolean };
      if (!result?.ok) throw new Error('send_failed');
      setText('');
      setPolicy('none');
      await load();
    } catch {
      setActionError(t.collaborationRoomActionFailed);
    } finally {
      setSending(false);
    }
  };

  const archiveRoom = async () => {
    const result = await desktop.archiveCollaborationRoom({ roomId, expectedRoomRevision: snapshot?.room?.revision }) as { ok?: boolean };
    if (result?.ok) await load(); else setActionError(t.collaborationRoomActionFailed);
  };

  const saveMembers = async () => {
    const addAgentIds = memberSelection.filter((id) => !activeAgentIds.includes(id));
    const removeAgentIds = activeAgentIds.filter((id) => !memberSelection.includes(id));
    const result = await desktop.updateCollaborationRoomMembers({
      roomId,
      expectedRoomRevision: snapshot?.room?.revision,
      addAgentIds,
      removeAgentIds,
    }) as { ok?: boolean };
    if (!result?.ok) setActionError(t.collaborationRoomActionFailed);
    setShowMembers(false);
    await load();
  };

  const createProject = async () => {
    if (!projectName.trim() || !projectGoal.trim() || !projectPo || selectedMessages.length === 0) return;
    const result = await desktop.createProjectFromRoom({
      roomId,
      name: projectName.trim(),
      goal: projectGoal.trim(),
      poAgentId: projectPo,
      memberAgentIds: projectMembers.filter((id) => id !== projectPo),
      sourceMessageIds: selectedMessages,
      clientRequestKey: crypto.randomUUID(),
    }) as { ok?: boolean; project?: { id?: string } };
    if (!result?.ok) {
      setActionError(t.collaborationRoomActionFailed);
      return;
    }
    setShowProject(false);
    setSelectedMessages([]);
    await load();
    if (result.project?.id) navigate(`/projects/${result.project.id}`);
  };

  if (viewState === 'loading') return <div className="p-8 text-sm text-[var(--c-text-secondary)]" data-testid="room-view-loading">{t.collaborationRoomLoading}</div>;
  if (viewState === 'error') return <div className="p-8" data-testid="room-view-error"><div>{t.collaborationRoomError}</div><button type="button" onClick={() => void load()} className="mt-3 text-[var(--c-accent)]">{t.retryConnection}</button></div>;
  if (viewState === 'degraded') return <div className="p-8" data-testid="room-view-degraded"><div>{t.collaborationRoomDegraded}</div>{(degradedProjects ?? []).map((project) => <div key={project.id}>{project.name}</div>)}</div>;

  const archived = snapshot?.room?.status === 'archived' || snapshot?.room?.status === 'archiving';
  const messages = snapshot?.messages ?? [];

  return (
    <main className="flex h-full min-w-0 flex-col bg-[var(--c-bg-page)]">
      <header className="flex items-center gap-3 border-b border-[var(--c-border)] px-6 py-4">
        <Link to="/collaboration" aria-label={t.collaborationRoomBackToList} className="rounded-md p-1.5 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-[var(--c-text-heading)]">{snapshot?.room?.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--c-text-tertiary)]"><Users size={13} />{activeAgentIds.length}</div>
        </div>
        <button type="button" onClick={() => setShowMembers((value) => !value)} className="rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)]">{t.collaborationRoomMembersLabel}</button>
        <button type="button" aria-label={t.collaborationRoomRefresh} onClick={() => void load()} className="rounded-lg p-2 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><RefreshCw size={16} /></button>
        {!archived && <button type="button" aria-label={t.collaborationRoomArchive} onClick={() => void archiveRoom()} className="rounded-lg p-2 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><Archive size={16} /></button>}
      </header>

      {archived && <div className="border-b border-[var(--c-border)] bg-[var(--c-bg-deep)] px-6 py-2 text-sm text-[var(--c-text-secondary)]" data-testid="room-view-archived">{t.collaborationRoomArchived}</div>}
      {showMembers && !archived && (
        <section className="border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {availableAgents.map((agent) => <label key={agent.id} className="flex items-center gap-2 rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-primary)]"><input type="checkbox" checked={memberSelection.includes(agent.id)} onChange={(event) => setMemberSelection((current) => event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} />{agent.name}</label>)}
            <button type="button" onClick={() => void saveMembers()} className="rounded-full bg-[var(--c-accent)] px-4 py-1.5 text-xs font-medium text-white">{t.collaborationRoomSaveMembers}</button>
          </div>
        </section>
      )}

      <section className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && <div className="py-16 text-center text-sm text-[var(--c-text-secondary)]" data-testid="room-view-empty">{t.collaborationRoomEmpty}</div>}
        <div className="mx-auto max-w-3xl space-y-3" data-testid={messages.length ? 'room-view-messages' : undefined}>
          {messages.map((message) => {
            const sender = message.sender?.kind === 'user' ? t.collaborationRoomMessageByYou : message.sender?.logicalAgentId ?? t.collaborationRoomSystemMessage;
            return <article key={message.messageId} data-testid="room-message" className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--c-text-tertiary)]"><span>{sender}</span>{!archived && message.kind === 'text' && <label className="flex items-center gap-1.5"><input type="checkbox" aria-label={t.collaborationRoomSelectForProject} checked={selectedMessages.includes(message.messageId)} onChange={(event) => setSelectedMessages((current) => event.target.checked ? [...current, message.messageId] : current.filter((id) => id !== message.messageId))} />{t.collaborationRoomSelectForProject}</label>}</div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--c-text-primary)]">{message.text}</p>
            </article>;
          })}
        </div>
        {(snapshot?.projects ?? []).length > 0 && <div className="mx-auto mt-5 max-w-3xl"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-tertiary)]">{t.collaborationRoomLinkedProjects}</h2>{snapshot?.projects?.map((project) => <Link key={project.id} to={`/projects/${project.id}`} className="mr-2 inline-flex rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm text-[var(--c-text-primary)]">{project.name ?? project.id}</Link>)}</div>}
      </section>

      {!archived && <footer className="border-t border-[var(--c-border)] px-6 py-4" data-testid="room-composer">
        <div className="mx-auto max-w-3xl">
          {selectedMessages.length > 0 && <button type="button" onClick={() => { setProjectPo(activeAgentIds[0] ?? ''); setProjectMembers(activeAgentIds.slice(1)); setShowProject(true); }} className="mb-3 inline-flex items-center gap-2 rounded-lg border border-[var(--c-accent)] px-3 py-2 text-xs text-[var(--c-accent)]"><FolderPlus size={15} />{t.collaborationRoomCreateProject}</button>}
          <div className="flex items-end gap-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-2 focus-within:border-[var(--c-accent)]">
            <textarea aria-label={t.collaborationRoomComposerPlaceholder} placeholder={t.collaborationRoomComposerPlaceholder} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--c-text-primary)] outline-none" />
            <select aria-label={t.collaborationRoomTeamDiscussion} value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)} className="mb-1 rounded-md bg-[var(--c-bg-deep)] px-2 py-1.5 text-xs text-[var(--c-text-secondary)]"><option value="none">{t.collaborationRoomNormalReply}</option><option value="mentioned">{t.collaborationRoomMentionReply}</option><option value="team_once">{t.collaborationRoomTeamDiscussion}</option></select>
            <button type="button" aria-label={t.collaborationRoomSend} disabled={!text.trim() || sending} onClick={() => void sendMessage()} className="mb-0.5 flex size-9 items-center justify-center rounded-lg bg-[var(--c-accent)] text-white disabled:opacity-40"><Send size={16} /></button>
          </div>
          {actionError && <p className="mt-2 text-xs text-[var(--c-error)]">{actionError}</p>}
        </div>
      </footer>}

      {showProject && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t.collaborationRoomCreateProject}><div className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6"><h2 className="text-lg font-semibold text-[var(--c-text-heading)]">{t.collaborationRoomCreateProject}</h2><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectName}<input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 text-[var(--c-text-primary)]" /></label><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectGoal}<textarea value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-primary)]" /></label><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectOwner}<select value={projectPo} onChange={(event) => setProjectPo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 text-[var(--c-text-primary)]">{activeAgentIds.map((id) => <option key={id} value={id}>{availableAgents.find((agent) => agent.id === id)?.name ?? id}</option>)}</select></label><fieldset><legend className="mb-2 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectMembers}</legend><div className="flex flex-wrap gap-2">{activeAgentIds.filter((id) => id !== projectPo).map((id) => <label key={id} className="flex items-center gap-2 rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs"><input type="checkbox" checked={projectMembers.includes(id)} onChange={(event) => setProjectMembers((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{availableAgents.find((agent) => agent.id === id)?.name ?? id}</label>)}</div></fieldset><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowProject(false)} className="h-9 px-4 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomCancel}</button><button type="button" disabled={!projectName.trim() || !projectGoal.trim() || !projectPo} onClick={() => void createProject()} className="h-9 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-white disabled:opacity-40">{t.collaborationRoomCreateProject}</button></div></div></div>}
    </main>
  );
}
