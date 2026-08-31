import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, BookOpen, Check, Copy, ExternalLink, FileText, FolderPlus, RefreshCw, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import { desktop, type CollaborationRoomEvent, type RoomUiSnapshot } from '../../lib/desktop';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { ArtifactPreviewModal } from '../projects/ArtifactPreviewModal';
import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';
import { ChatInput, type AttachedFile } from '../ChatInput';
import { XIAOK_WORKER_SEED_ID } from '../../../../shared/kswarm-seed-contract.js';
import { getDesktopApi } from '../../shared/desktop';

export interface CollaborationRoomViewProps {
  roomId: string;
  degradedProjects?: Array<{ id: string; name: string }>;
  availableAgents?: Array<{ id: string; name: string }>;
}

type ViewState = 'loading' | 'error' | 'degraded' | 'ready';

function artifactFromRoomMessage(message: NonNullable<RoomUiSnapshot['messages']>[number]): KSwarmArtifact | null {
  const sourceRef = message.sourceRef;
  const artifact = sourceRef?.artifact;
  if (
    message.kind !== 'project_event'
    || sourceRef?.eventType !== 'artifact.registered'
    || !sourceRef.projectId
    || !sourceRef.artifactId
    || !artifact?.filename
  ) return null;
  return {
    projectId: sourceRef.projectId,
    filename: artifact.filename,
    name: artifact.filename,
    type: artifact.kind,
    mimeType: artifact.mimeType,
  };
}

export function CollaborationRoomView({ roomId, degradedProjects, availableAgents = [] }: CollaborationRoomViewProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<RoomUiSnapshot | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [text, setText] = useState('');
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
  const [previewArtifact, setPreviewArtifact] = useState<KSwarmArtifact | null>(null);
  const [pendingDiscussions, setPendingDiscussions] = useState<Record<string, number>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);
  const [messageActionNotice, setMessageActionNotice] = useState<{ messageId: string; text: string } | null>(null);
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setViewState('loading');
    try {
      const result = await desktop.getCollaborationRoom(roomId);
      setSnapshot(result);
      setViewState(result.ok ? 'ready' : result.degraded ? 'degraded' : 'error');
      const lastSequence = Math.max(0, ...(result.messages ?? []).map((message) => message.roomSequence ?? 0));
      if (result.ok && lastSequence > 0) {
        void desktop.markCollaborationRoomSeen({ roomId, lastSeenRoomSequence: lastSequence });
      }
    } catch {
      if (showLoading) setViewState('error');
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current);
    if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
  }, []);

  useEffect(() => desktop.onCollaborationRoomEvent((event: CollaborationRoomEvent) => {
    if (event.roomId !== roomId) return;
    if (event.type === 'wake_settled') {
      setPendingDiscussions((current) => (
        Object.hasOwn(current, event.roomMessageId)
          ? { ...current, [event.roomMessageId]: event.remaining }
          : current
      ));
    } else {
      setPendingDiscussions((current) => {
        if (!Object.hasOwn(current, event.roomMessageId)) return current;
        const next = { ...current };
        delete next[event.roomMessageId];
        return next;
      });
      if (event.failed.length > 0) {
        setActionError(t.collaborationRoomRepliesPartiallyFailed(event.failed.length));
      }
    }
    void load(false);
  }), [load, roomId, t]);

  const activeAgentIds = useMemo(() => (snapshot?.members ?? [])
    .filter((member) => member.status === 'active' && member.subject.kind === 'agent')
    .map((member) => member.subject.kind === 'agent' ? member.subject.logicalAgentId : ''), [snapshot]);

  useEffect(() => { setMemberSelection(activeAgentIds); }, [activeAgentIds.join('|')]);

  const mentionItems = useMemo(() => activeAgentIds.map((id) => ({
    id,
    label: availableAgents.find((agent) => agent.id === id)?.name ?? id,
  })), [activeAgentIds, availableAgents]);

  const sendMessage = async (messageText: string, files: AttachedFile[]): Promise<boolean> => {
    if ((!messageText.trim() && files.length === 0) || sending) return false;
    setSending(true);
    setActionError(null);
    try {
      const result = await desktop.sendCollaborationRoomMessage({
        roomId,
        text: messageText.trim(),
        filePaths: files.map((file) => file.filePath),
        idempotencyKey: crypto.randomUUID(),
      }) as {
        ok?: boolean;
        wake?: { status?: string; roomMessageId?: string; logicalAgentIds?: string[] };
      };
      if (!result?.ok) {
        setActionError(t.collaborationRoomActionFailed);
        return false;
      }
      if (
        result.wake?.status === 'queued'
        && typeof result.wake.roomMessageId === 'string'
        && Array.isArray(result.wake.logicalAgentIds)
        && result.wake.logicalAgentIds.length > 0
      ) {
        setPendingDiscussions((current) => ({
          ...current,
          [result.wake!.roomMessageId!]: result.wake!.logicalAgentIds!.length,
        }));
      }
      setText('');
      void load(false);
      return true;
    } catch {
      setActionError(t.collaborationRoomActionFailed);
      return false;
    } finally {
      setSending(false);
    }
  };

  const archiveRoom = async () => {
    const result = await desktop.archiveCollaborationRoom({ roomId, expectedRoomRevision: snapshot?.room?.revision }) as { ok?: boolean };
    if (result?.ok) await load(); else setActionError(t.collaborationRoomActionFailed);
  };

  const saveMembers = async () => {
    const canonicalSelection = [...new Set([...memberSelection, XIAOK_WORKER_SEED_ID])];
    const addAgentIds = canonicalSelection.filter((id) => !activeAgentIds.includes(id));
    const removeAgentIds = activeAgentIds.filter((id) => id !== XIAOK_WORKER_SEED_ID && !canonicalSelection.includes(id));
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

  const copyMessage = useCallback(async (messageId: string, messageText: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(messageText);
      setCopiedMessageId(messageId);
      setMessageActionNotice(null);
      if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current);
      copiedResetTimer.current = setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      setMessageActionNotice({ messageId, text: t.collaborationRoomCopyFailed });
    }
  }, [t]);

  const saveMessageToKnowledge = useCallback(async (messageId: string, sender: string, messageText: string) => {
    if (savingMessageId) return;
    const knowledgeApi = getDesktopApi();
    if (!knowledgeApi?.kbListCollections || !knowledgeApi.kbAddSource) {
      setMessageActionNotice({ messageId, text: t.collaborationRoomKnowledgeSaveFailed });
      return;
    }
    setSavingMessageId(messageId);
    setMessageActionNotice(null);
    try {
      const collections = await knowledgeApi.kbListCollections() as Array<{ id?: string }>;
      const collectionId = collections.find((collection) => typeof collection.id === 'string' && collection.id)?.id;
      if (!collectionId) {
        setMessageActionNotice({ messageId, text: t.collaborationRoomKnowledgeNoCollections });
        return;
      }
      const excerpt = messageText.replace(/[#*_`\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50)
        || t.collaborationRoomMessageExcerpt;
      await knowledgeApi.kbAddSource({
        collectionId,
        kind: 'paste',
        title: t.collaborationRoomKnowledgeTitle(sender, excerpt),
        text: messageText,
      });
      setSavedMessageId(messageId);
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
      savedResetTimer.current = setTimeout(() => setSavedMessageId(null), 2500);
    } catch {
      setMessageActionNotice({ messageId, text: t.collaborationRoomKnowledgeSaveFailed });
    } finally {
      setSavingMessageId(null);
    }
  }, [savingMessageId, t]);

  if (viewState === 'loading') return <div className="p-8 text-sm text-[var(--c-text-secondary)]" data-testid="room-view-loading">{t.collaborationRoomLoading}</div>;
  if (viewState === 'error') return <div className="p-8" data-testid="room-view-error"><div>{t.collaborationRoomError}</div><button type="button" onClick={() => void load()} className="mt-3 text-[var(--c-accent)]">{t.retryConnection}</button></div>;
  if (viewState === 'degraded') return <div className="p-8" data-testid="room-view-degraded"><div>{t.collaborationRoomDegraded}</div>{(degradedProjects ?? []).map((project) => <div key={project.id}>{project.name}</div>)}</div>;

  const archived = snapshot?.room?.status === 'archived' || snapshot?.room?.status === 'archiving';
  const messages = snapshot?.messages ?? [];
  const pendingReplyCount = Object.values(pendingDiscussions).reduce((total, count) => total + count, 0);

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
            {availableAgents.map((agent) => <label key={agent.id} className="flex items-center gap-2 rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-primary)]"><input type="checkbox" disabled={agent.id === XIAOK_WORKER_SEED_ID} checked={memberSelection.includes(agent.id) || agent.id === XIAOK_WORKER_SEED_ID} onChange={(event) => setMemberSelection((current) => event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} />{agent.name}</label>)}
            <button type="button" onClick={() => void saveMembers()} className="rounded-full bg-[var(--c-accent)] px-4 py-1.5 text-xs font-medium text-white">{t.collaborationRoomSaveMembers}</button>
          </div>
        </section>
      )}

      <section className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && <div className="py-16 text-center text-sm text-[var(--c-text-secondary)]" data-testid="room-view-empty">{t.collaborationRoomEmpty}</div>}
        <div className="mx-auto max-w-3xl space-y-3" data-testid={messages.length ? 'room-view-messages' : undefined}>
          {messages.map((message) => {
            const sender = message.sender?.kind === 'user' ? t.collaborationRoomMessageByYou : message.sender?.logicalAgentId ?? t.collaborationRoomSystemMessage;
            const artifact = artifactFromRoomMessage(message);
            const selectedForProject = selectedMessages.includes(message.messageId);
            const copied = copiedMessageId === message.messageId;
            const saving = savingMessageId === message.messageId;
            const saved = savedMessageId === message.messageId;
            return <article key={message.messageId} data-testid="room-message" className="group rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
              <div className="mb-2 text-xs text-[var(--c-text-tertiary)]"><span>{sender}</span></div>
              <div className="min-w-0 overflow-hidden text-[var(--c-text-primary)]">
                <MarkdownRenderer content={message.text ?? ''} disableLinkify />
              </div>
              {(message.sourceRef?.attachments ?? []).length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                {message.sourceRef?.attachments?.map((attachment) => <span key={attachment.filePath} title={attachment.filePath} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-[var(--c-bg-deep)] px-3 py-2 text-xs text-[var(--c-text-secondary)]"><FileText size={14} className="shrink-0" /><span className="truncate">{attachment.name}</span></span>)}
              </div>}
              {artifact && <button
                type="button"
                data-testid={`room-artifact-${artifact.filename}`}
                aria-label={`${t.chatView.open} ${artifact.filename}`}
                onClick={() => setPreviewArtifact(artifact)}
                className="mt-3 flex w-full items-center gap-3 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-deep)] px-3.5 py-3 text-left transition-colors hover:border-[var(--c-accent)]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-card)] text-[var(--c-accent)]"><FileText size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--c-text-heading)]">{artifact.filename}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--c-text-tertiary)]">{artifact.mimeType || artifact.type || t.chatView.artifact}</span>
                </span>
                <ExternalLink size={15} className="shrink-0 text-[var(--c-text-muted)]" />
              </button>}
              {message.kind === 'text' && <div
                data-testid={`room-message-actions-${message.messageId}`}
                className="pointer-events-none mt-2 flex min-h-7 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
              >
                {messageActionNotice?.messageId === message.messageId && <span role="status" className="mr-auto text-xs text-[var(--c-text-secondary)]">{messageActionNotice.text}</span>}
                {!archived && <button
                  type="button"
                  aria-label={selectedForProject ? t.collaborationRoomRemoveFromProjectBackground : t.collaborationRoomAddToProjectBackground}
                  title={selectedForProject ? t.collaborationRoomRemoveFromProjectBackground : t.collaborationRoomAddToProjectBackground}
                  aria-pressed={selectedForProject}
                  onClick={() => setSelectedMessages((current) => selectedForProject ? current.filter((id) => id !== message.messageId) : [...current, message.messageId])}
                  className={`inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] ${selectedForProject ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-tertiary)]'}`}
                >
                  {selectedForProject ? <Check size={14} /> : <FolderPlus size={14} />}
                </button>}
                <button
                  type="button"
                  aria-label={copied ? t.collaborationRoomCopiedMessage : t.collaborationRoomCopyMessage}
                  title={copied ? t.collaborationRoomCopiedMessage : t.collaborationRoomCopyMessage}
                  onClick={() => void copyMessage(message.messageId, message.text ?? '')}
                  className={`inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] ${copied ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-tertiary)]'}`}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  aria-label={saving ? t.collaborationRoomKnowledgeSaving : saved ? t.collaborationRoomSavedToKnowledge : t.collaborationRoomSaveToKnowledge}
                  title={saving ? t.collaborationRoomKnowledgeSaving : saved ? t.collaborationRoomSavedToKnowledge : t.collaborationRoomSaveToKnowledge}
                  disabled={saving}
                  onClick={() => void saveMessageToKnowledge(message.messageId, sender, message.text ?? '')}
                  className={`inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] disabled:cursor-wait disabled:opacity-50 ${saved ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-tertiary)]'}`}
                >
                  {saved ? <Check size={14} /> : <BookOpen size={14} />}
                </button>
              </div>}
            </article>;
          })}
        </div>
        {(snapshot?.projects ?? []).length > 0 && <div className="mx-auto mt-5 max-w-3xl"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-tertiary)]">{t.collaborationRoomLinkedProjects}</h2>{snapshot?.projects?.map((project) => <Link key={project.id} to={`/projects/${project.id}`} className="mr-2 inline-flex rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm text-[var(--c-text-primary)]">{project.name ?? project.id}</Link>)}</div>}
      </section>

      {!archived && <footer className="px-6 py-4" data-testid="room-composer">
        <div className="mx-auto max-w-3xl">
          {pendingReplyCount > 0 && <p data-testid="room-discussion-pending" className="mb-2 text-xs text-[var(--c-text-secondary)]">{t.collaborationRoomWaitingForReplies(pendingReplyCount)}</p>}
          {selectedMessages.length > 0 && <button type="button" onClick={() => { setProjectPo(activeAgentIds[0] ?? ''); setProjectMembers(activeAgentIds.slice(1)); setShowProject(true); }} className="mb-3 inline-flex items-center gap-2 rounded-lg border border-[var(--c-accent)] px-3 py-2 text-xs text-[var(--c-accent)]"><FolderPlus size={15} />{t.collaborationRoomCreateProject}</button>}
          <ChatInput
            value={text}
            onChange={setText}
            onSubmit={sendMessage}
            placeholder={t.collaborationRoomComposerPlaceholder}
            disabled={sending}
            mentionItems={mentionItems}
            mentionAllLabel={t.collaborationRoomMentionAll}
          />
          {actionError && <p className="mt-2 text-xs text-[var(--c-error)]">{actionError}</p>}
        </div>
      </footer>}

      {showProject && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t.collaborationRoomCreateProject}><div className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6"><h2 className="text-lg font-semibold text-[var(--c-text-heading)]">{t.collaborationRoomCreateProject}</h2><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectName}<input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 text-[var(--c-text-primary)]" /></label><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectGoal}<textarea value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-primary)]" /></label><label className="block text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectOwner}<select value={projectPo} onChange={(event) => setProjectPo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 text-[var(--c-text-primary)]">{activeAgentIds.map((id) => <option key={id} value={id}>{availableAgents.find((agent) => agent.id === id)?.name ?? id}</option>)}</select></label><fieldset><legend className="mb-2 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomProjectMembers}</legend><div className="flex flex-wrap gap-2">{activeAgentIds.filter((id) => id !== projectPo).map((id) => <label key={id} className="flex items-center gap-2 rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs"><input type="checkbox" checked={projectMembers.includes(id)} onChange={(event) => setProjectMembers((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{availableAgents.find((agent) => agent.id === id)?.name ?? id}</label>)}</div></fieldset><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowProject(false)} className="h-9 px-4 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomCancel}</button><button type="button" disabled={!projectName.trim() || !projectGoal.trim() || !projectPo} onClick={() => void createProject()} className="h-9 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-white disabled:opacity-40">{t.collaborationRoomCreateProject}</button></div></div></div>}
      {previewArtifact && <ArtifactPreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
    </main>
  );
}
