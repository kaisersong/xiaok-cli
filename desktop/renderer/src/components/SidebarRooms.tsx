import { useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { desktop, type RoomListResult } from '../lib/desktop';
import { getDesktopApi } from '../shared/desktop';

export function SidebarRooms({ activePath, onOpen }: { activePath: string; onOpen: (roomId: string) => void }) {
  const { t } = useLocale();
  const [result, setResult] = useState<RoomListResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let epoch = 0;
    const load = async () => {
      const token = ++epoch;
      try {
        const next = await desktop.listCollaborationRooms();
        if (!disposed && token === epoch) setResult(next);
      } catch { if (!disposed && token === epoch) setResult({ ok: false }); }
    };
    setResult(null);
    void load();
    const unsubscribe = getDesktopApi()?.onCollaborationRoomEvent?.(() => { void load(); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [activePath, refresh]);
  const rooms = (result?.rooms ?? []).filter(room => room.status !== 'archived');
  return <div className="flex min-h-0 flex-1 flex-col py-1">
    {result === null ? <p role="status" className="px-4 py-6 text-center text-xs text-[var(--c-text-tertiary)]">{t.loading}</p>
      : !result.ok ? <div className="px-4 py-6 text-center text-xs text-[var(--c-text-secondary)]"><p role="alert">{t.sidebarRoomsUnavailable}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="mt-2 text-[var(--c-accent)]">{t.sidebarRetry}</button></div>
      : rooms.length === 0 ? <p className="px-4 py-6 text-center text-xs text-[var(--c-text-tertiary)]">{t.sidebarEmptyRooms}</p>
      : <div className="min-h-0 flex-1 overflow-y-auto px-2 sidebar-scroll">{rooms.map(room => <button key={room.roomId} type="button" onClick={() => onOpen(room.roomId)} title={room.title} aria-current={activePath === `/collaboration/${room.roomId}` ? 'page' : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${activePath === `/collaboration/${room.roomId}` ? 'bg-[var(--c-bg-card)] font-medium text-[var(--c-text-primary)]' : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-card)]'}`}>
        <MessagesSquare size={13} className="shrink-0 text-[var(--c-text-tertiary)]" /><span className="truncate">{room.title || t.untitled}</span>
      </button>)}</div>}
  </div>;
}
