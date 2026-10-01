import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, Clock3, MoreHorizontal, Trash2, MessageSquare, Plus, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { desktop, type RoomListResult } from '../../lib/desktop';
import { XIAOK_WORKER_SEED_ID } from '../../../../shared/kswarm-seed-contract';

export function CollaborationRoomsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { agents } = useKSwarm();
  const [result, setResult] = useState<RoomListResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  const [archivingRoomId, setArchivingRoomId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [category, setCategory] = useState<'active' | 'archived'>('active');
  const [deleteTarget, setDeleteTarget] = useState<NonNullable<RoomListResult['rooms']>[number] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await desktop.listCollaborationRooms();
      if (!mounted.current || version !== requestVersion.current) return;
      if (next.ok) {setResult(next); setRefreshFailed(false);}
      else {setResult(current => current?.ok ? current : next); setRefreshFailed(true);}
    } catch {
      if (!mounted.current || version !== requestVersion.current) return;
      setResult(current => current ?? {ok: false}); setRefreshFailed(true);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const refresh = () => {void load();};
    const unsubscribe = desktop.onCollaborationRoomEvent(refresh);
    window.addEventListener('focus', refresh);
    return () => {mounted.current = false; ++requestVersion.current; unsubscribe(); window.removeEventListener('focus', refresh);};
  }, [load]);
  useEffect(() => {
    if (!menuRoomId) return;
    const dismiss = (event: PointerEvent) => {if (!menuRef.current?.contains(event.target as Node)) setMenuRoomId(null);};
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuRoomId]);
  const archiveRoom = async (room: NonNullable<RoomListResult['rooms']>[number]) => {
    if (archivingRoomId || room.status !== 'active') return;
    setArchivingRoomId(room.roomId); setActionError(null); setMenuRoomId(null); ++requestVersion.current;
    try {
      const outcome = await desktop.archiveCollaborationRoom({roomId: room.roomId, expectedRoomRevision: room.revision}) as {ok?: boolean};
      if (mounted.current && !outcome?.ok) setActionError(t.collaborationRoomActionFailed);
    } catch {if (mounted.current) setActionError(t.collaborationRoomActionFailed);}
    finally {if (mounted.current) {setArchivingRoomId(null); void load();}}
  };
  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null); setDeleteError(null); deleteTrigger.current?.focus();
  };
  const deleteRoom = async () => {
    if (!deleteTarget || deleting || deleteConflict || !Number.isSafeInteger(deleteTarget.revision)) return;
    setDeleting(true); setDeleteError(null); ++requestVersion.current;
    try {
      const removed = await desktop.deleteCollaborationRoom({roomId: deleteTarget.roomId, expectedRoomRevision: deleteTarget.revision!}) as {ok?: boolean; code?: string};
      if (!mounted.current) return;
      if (removed?.ok) {
        ++requestVersion.current;
        setResult(current => current ? {...current, rooms: current.rooms?.filter(room => room.roomId !== deleteTarget.roomId)} : current);
        setDeleteTarget(null);
      } else {
        setDeleteConflict(removed?.code === 'room_revision_conflict');
        setDeleteError(removed?.code === 'room_delete_pending' || removed?.code === 'disclosure_revocation_pending'
          ? t.collaborationRoomDeletePending : removed?.code === 'room_revision_conflict' ? t.collaborationRoomDeleteConflict : t.collaborationRoomDeleteFailed);
      }
    } catch {if (mounted.current) setDeleteError(t.collaborationRoomDeleteFailed);}
    finally {if (mounted.current) {setDeleting(false); void load();}}
  };
  const activity = (room: NonNullable<RoomListResult['rooms']>[number]) =>
    [room.lastActivityAt, room.updatedAt, room.createdAt].find(value => value && Number.isFinite(Date.parse(value)));
  const sortedRooms = [...(result?.rooms ?? [])].sort((a, b) => {
    const left = activity(a), right = activity(b);
    const delta = (right ? Date.parse(right) : -Infinity) - (left ? Date.parse(left) : -Infinity);
    return delta || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0);
  });
  const activeRooms = sortedRooms.filter(room => room.status === 'active');
  const archivedRooms = sortedRooms.filter(room => room.status === 'archived' || room.status === 'archiving');
  const visibleRooms = category === 'active' ? activeRooms : archivedRooms;
  const formatTime = useMemo(() => new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}), [locale]);

  const createRoom = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await desktop.createCollaborationRoom({
        title: title.trim(),
        description: description.trim() || undefined,
        memberAgentIds,
        clientRequestKey: crypto.randomUUID(),
      }) as { ok?: boolean; room?: { roomId?: string } };
      if (!created?.ok || !created.room?.roomId) {
        setError(t.collaborationRoomCreateFailed);
        return;
      }
      navigate(`/collaboration/${created.room.roomId}`);
    } catch {
      setError(t.collaborationRoomCreateFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto bg-[var(--c-bg-page)] px-8 py-7">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--c-text-heading)]">{t.collaborationRoomsTitle}</h1>
            <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomsSubtitle}</p>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--c-accent-send)] px-4 text-sm font-medium text-[var(--c-accent-send-text)] hover:bg-[var(--c-accent-send-hover)]">
            <Plus size={16} /> {t.collaborationRoomsCreate}
          </button>
        </header>

        <div role="tablist" aria-label={t.collaborationRoomsTitle} className="mb-5 flex gap-2 border-b border-[var(--c-border)] pb-3">
          {(['active', 'archived'] as const).map(value => (
            <button key={value} type="button" role="tab" aria-selected={category === value} aria-controls="collaboration-room-list" onClick={() => {setCategory(value); setMenuRoomId(null);}} className={`rounded-lg px-4 py-2 text-sm font-medium ${category === value ? 'bg-[var(--c-bg-deep)] text-[var(--c-accent)]' : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'}`}>
              {value === 'active' ? t.collaborationRoomsActive : t.collaborationRoomsArchived} <span className="ml-1.5 text-xs">{value === 'active' ? activeRooms.length : archivedRooms.length}</span>
            </button>
          ))}
        </div>
        {actionError && <p role="alert" className="mb-4 text-sm text-destructive-text">{actionError}</p>}
        {refreshFailed && result?.ok && <div role="alert" className="mb-4 text-sm text-destructive-text">{t.collaborationRoomError} <button type="button" onClick={() => void load()} className="ml-2 text-[var(--c-accent)]">{t.retryConnection}</button></div>}

        {!result ? (
          <div className="py-16 text-center text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomLoading}</div>
        ) : !result.ok ? (
          <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-8 text-center">
            <p className="text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomError}</p>
            <button type="button" onClick={() => void load()} className="mt-4 text-sm text-[var(--c-accent)]">{t.retryConnection}</button>
          </div>
        ) : visibleRooms.length === 0 && (category === 'archived' || (result.rooms ?? []).length > 0) ? (
          <p className="py-16 text-center text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomsCategoryEmpty}</p>
        ) : visibleRooms.length === 0 ? (
          <button type="button" onClick={() => setShowCreate(true)} className="flex w-full flex-col items-center rounded-2xl border border-dashed border-[var(--c-border)] bg-[var(--c-bg-card)] px-8 py-16 text-center hover:border-[var(--c-accent)]">
            <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]"><MessageSquare size={22} /></span>
            <span className="text-base font-medium text-[var(--c-text-heading)]">{t.collaborationRoomsEmptyTitle}</span>
            <span className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomsEmptyBody}</span>
          </button>
        ) : (
          <div id="collaboration-room-list" className="grid gap-3 md:grid-cols-2">
            {visibleRooms.map(room => {
              const timestamp = activity(room);
              return <article key={room.roomId} className="group flex flex-col rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] hover:border-[var(--c-accent)]">
                <button type="button" onClick={() => navigate(`/collaboration/${room.roomId}`)} className="flex flex-1 items-start justify-between gap-4 p-5 text-left">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--c-text-heading)]">{room.title}</div>
                    {room.description && <p className="mt-2 line-clamp-2 text-sm text-[var(--c-text-secondary)]">{room.description}</p>}
                  </div>
                  <ArrowRight size={17} className="mt-1 shrink-0 text-[var(--c-text-tertiary)] group-hover:text-[var(--c-accent)]" />
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--c-bg-deep)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)]">
                    <Clock3 size={12} /> {t.collaborationRoomLastActive}
                    {timestamp ? <time dateTime={timestamp} title={new Date(timestamp).toLocaleString(locale)}>{formatTime.format(new Date(timestamp))}</time> : t.collaborationRoomTimeUnknown}
                  </span>
                  {room.status === 'archiving' && <span className="text-xs text-[var(--c-text-secondary)]">{t.collaborationRoomArchiving}</span>}
                  <div className="relative" ref={menuRoomId === room.roomId ? menuRef : undefined}>
                    <button type="button" aria-label={t.collaborationRoomMore} title={t.collaborationRoomMore} aria-haspopup="menu" aria-expanded={menuRoomId === room.roomId} disabled={Boolean(archivingRoomId)} onClick={event => {deleteTrigger.current = event.currentTarget; setMenuRoomId(current => current === room.roomId ? null : room.roomId);}} className="rounded-lg p-1.5 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] disabled:opacity-40"><MoreHorizontal size={17} /></button>
                    {menuRoomId === room.roomId && <div role="menu" aria-label={t.collaborationRoomMore} className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-1 shadow-lg" onKeyDown={event => {
                    if (event.key === 'Escape') {setMenuRoomId(null); deleteTrigger.current?.focus();}
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
                      const index = items.indexOf(document.activeElement as HTMLButtonElement);
                      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
                    }
                  }}>
                      <button autoFocus type="button" role="menuitem" disabled={room.status !== 'active' || !Number.isSafeInteger(room.revision)} onClick={() => void archiveRoom(room)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-40"><Archive size={14} />{t.collaborationRoomArchive}</button>
                      <button type="button" role="menuitem" disabled={!Number.isSafeInteger(room.revision)} onClick={() => {setMenuRoomId(null); setDeleteTarget(room); setDeleteError(null); setDeleteConflict(false);}} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive-text hover:bg-[var(--c-bg-deep)] disabled:opacity-40"><Trash2 size={14} />{t.collaborationRoomDelete}</button>
                    </div>}
                  </div>
                </div>
              </article>;
            })}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t.collaborationRoomDelete} onKeyDown={event => {
          if (event.key === 'Escape') {event.preventDefault(); closeDelete();}
          if (event.key === 'Tab') {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
            else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
          }
        }}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--c-text-heading)]">{t.collaborationRoomDelete}</h2>
            <p className="mt-3 break-words font-medium text-[var(--c-text-primary)]">{deleteTarget.title}</p>
            <p className="mt-2 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomDeleteBody}</p>
            {deleteError && <p role="alert" className="mt-3 text-sm text-destructive-text">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button autoFocus type="button" disabled={deleting} onClick={closeDelete} className="h-9 rounded-lg px-4 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-40">{t.collaborationRoomCancel}</button>
              <button type="button" disabled={deleting || deleteConflict} onClick={() => void deleteRoom()} className="h-9 rounded-lg bg-destructive hover:bg-destructive/90 px-4 text-sm font-medium text-destructive-foreground disabled:opacity-60">{deleting ? t.collaborationRoomDeleting : t.collaborationRoomDelete}</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t.collaborationRoomsCreate}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--c-text-heading)]">{t.collaborationRoomsCreate}</h2>
              <button type="button" aria-label={t.collaborationRoomCancel} onClick={() => setShowCreate(false)} className="rounded-md p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><X size={18} /></button>
            </div>
            <label className="mb-4 block text-sm text-[var(--c-text-secondary)]">
              <span className="mb-1.5 block">{t.collaborationRoomTitleLabel}</span>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="h-10 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]" />
            </label>
            <label className="mb-4 block text-sm text-[var(--c-text-secondary)]">
              <span className="mb-1.5 block">{t.collaborationRoomDescriptionLabel}</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20 w-full resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]" />
            </label>
            <fieldset>
              <legend className="mb-2 flex items-center gap-2 text-sm text-[var(--c-text-secondary)]"><Users size={15} />{t.collaborationRoomMembersLabel}</legend>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[var(--c-border)] p-2">
                {agents.map((agent) => (
                  <label key={agent.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[var(--c-bg-deep)]">
                    <input
                      type="checkbox"
                      checked={agent.id === XIAOK_WORKER_SEED_ID || memberAgentIds.includes(agent.id)}
                      disabled={agent.id === XIAOK_WORKER_SEED_ID}
                      onChange={(event) => setMemberAgentIds((current) => event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))}
                    />
                    <span className="text-sm text-[var(--c-text-primary)]">{agent.name}</span>
                    <span className="ml-auto text-xs text-[var(--c-text-tertiary)]">{agent.id}</span>
                  </label>
                ))}
                {agents.length === 0 && <p className="p-3 text-center text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomNoMembers}</p>}
              </div>
            </fieldset>
            {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="h-9 rounded-lg px-4 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">{t.collaborationRoomCancel}</button>
              <button type="button" disabled={!title.trim() || submitting} onClick={() => void createRoom()} className="h-9 rounded-lg bg-[var(--c-accent-send)] px-4 text-sm font-medium text-[var(--c-accent-send-text)] hover:bg-[var(--c-accent-send-hover)] disabled:opacity-40">{t.collaborationRoomCreateSubmit}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
