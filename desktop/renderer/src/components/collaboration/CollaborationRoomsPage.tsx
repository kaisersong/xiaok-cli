import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, MessageSquare, Plus, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { desktop, type RoomListResult } from '../../lib/desktop';
import { XIAOK_WORKER_SEED_ID } from '../../../../shared/kswarm-seed-contract';

export function CollaborationRoomsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { agents } = useKSwarm();
  const [result, setResult] = useState<RoomListResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setResult(null);
    setResult(await desktop.listCollaborationRooms());
  }, []);

  useEffect(() => { void load(); }, [load]);

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
          <button type="button" onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-white">
            <Plus size={16} /> {t.collaborationRoomsCreate}
          </button>
        </header>

        {!result ? (
          <div className="py-16 text-center text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomLoading}</div>
        ) : result.ok === false ? (
          <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-8 text-center">
            <p className="text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomError}</p>
            <button type="button" onClick={() => void load()} className="mt-4 text-sm text-[var(--c-accent)]">{t.retryConnection}</button>
          </div>
        ) : (result.rooms ?? []).length === 0 ? (
          <button type="button" onClick={() => setShowCreate(true)} className="flex w-full flex-col items-center rounded-2xl border border-dashed border-[var(--c-border)] bg-[var(--c-bg-card)] px-8 py-16 text-center hover:border-[var(--c-accent)]">
            <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]"><MessageSquare size={22} /></span>
            <span className="text-base font-medium text-[var(--c-text-heading)]">{t.collaborationRoomsEmptyTitle}</span>
            <span className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.collaborationRoomsEmptyBody}</span>
          </button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(result.rooms ?? []).map((room) => (
              <button key={room.roomId} type="button" onClick={() => navigate(`/collaboration/${room.roomId}`)} className="group rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 text-left hover:border-[var(--c-accent)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--c-text-heading)]">{room.title}</div>
                    {room.description && <p className="mt-2 line-clamp-2 text-sm text-[var(--c-text-secondary)]">{room.description}</p>}
                  </div>
                  <ArrowRight size={17} className="mt-1 shrink-0 text-[var(--c-text-tertiary)] group-hover:text-[var(--c-accent)]" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

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
                  <label key={agent.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--c-bg-deep)]">
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
            {error && <p className="mt-3 text-sm text-[var(--c-error)]">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="h-9 rounded-lg px-4 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">{t.collaborationRoomCancel}</button>
              <button type="button" disabled={!title.trim() || submitting} onClick={() => void createRoom()} className="h-9 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-white disabled:opacity-40">{t.collaborationRoomCreateSubmit}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
