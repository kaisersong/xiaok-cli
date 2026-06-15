import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getDesktopApi } from '@xiaok/shared/desktop';

type GtdLabel = 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived';

interface ThreadMetaContextValue {
  gtdEnabled: boolean;
  setGtdEnabled: (v: boolean) => void;
  gtd: Record<GtdLabel, Set<string>>;
  pinned: Set<string>;
  addToLabel: (threadId: string, label: GtdLabel) => Promise<void>;
  removeFromLabel: (threadId: string, label: GtdLabel) => Promise<void>;
  moveLabel: (threadId: string, from: GtdLabel, to: GtdLabel) => Promise<void>;
  togglePin: (threadId: string) => Promise<void>;
  removeThread: (threadId: string) => Promise<void>;
  degraded: boolean;
}

const ThreadMetaContext = createContext<ThreadMetaContextValue | null>(null);

const EMPTY_GTD: Record<GtdLabel, Set<string>> = {
  inbox: new Set(),
  todo: new Set(),
  waiting: new Set(),
  someday: new Set(),
  archived: new Set(),
};

function toSet(arr: string[] | undefined): Set<string> {
  return arr ? new Set(arr) : new Set<string>();
}

export function ThreadMetaProvider({ children }: { children: ReactNode }) {
  const [gtd, setGtd] = useState<Record<GtdLabel, Set<string>>>(EMPTY_GTD);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [gtdEnabled, setGtdEnabledState] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const loadFromApi = useCallback(async () => {
    const api = getDesktopApi();
    if (!api) return;
    try {
      const snapshot = await api.getThreadLabels();
      setGtd({
        inbox: toSet(snapshot.inbox),
        todo: toSet(snapshot.todo),
        waiting: toSet(snapshot.waiting),
        someday: toSet(snapshot.someday),
        archived: toSet(snapshot.archived),
      });
      setPinned(toSet(snapshot.pinned));
      setGtdEnabledState(snapshot.gtdEnabled ?? false);
      setDegraded(false);
    } catch {
      setDegraded(true);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadFromApi();
  }, [loadFromApi]);

  // Listen for broadcasts from main process (multi-window sync)
  useEffect(() => {
    const api = getDesktopApi();
    if (!api) return;
    // Use window event listener for the broadcast channel
    const handler = () => { loadFromApi(); };
    // The onKSwarmWsEvent pattern doesn't apply here; we need a direct IPC listener.
    // Since getDesktopApi() doesn't expose an onThreadMetaChanged method,
    // we poll on focus instead for multi-window sync.
    window.addEventListener('focus', handler);
    return () => { window.removeEventListener('focus', handler); };
  }, [loadFromApi]);

  // Migration: check if localStorage has data that needs to be imported
  useEffect(() => {
    const api = getDesktopApi();
    if (!api) return;
    // Only attempt migration if there's localStorage data
    try {
      const hasLocalData = localStorage.getItem('xiaok:gtd:inbox') ||
        localStorage.getItem('xiaok:pinned');
      if (!hasLocalData) return;

      const snapshot = {
        gtdEnabled: localStorage.getItem('xiaok:gtd-enabled') === 'true',
        inbox: JSON.parse(localStorage.getItem('xiaok:gtd:inbox') || '[]'),
        todo: JSON.parse(localStorage.getItem('xiaok:gtd:todo') || '[]'),
        waiting: JSON.parse(localStorage.getItem('xiaok:gtd:waiting') || '[]'),
        someday: JSON.parse(localStorage.getItem('xiaok:gtd:someday') || '[]'),
        archived: JSON.parse(localStorage.getItem('xiaok:gtd:archived') || '[]'),
        pinned: JSON.parse(localStorage.getItem('xiaok:pinned') || '[]'),
      };
      api.migrateLegacyThreadMeta(snapshot).then((result) => {
        if (result.migrated) {
          // Reload after migration
          loadFromApi();
        }
      }).catch(() => { /* migration failure is non-critical */ });
    } catch { /* localStorage access may fail */ }
  }, [loadFromApi]);

  const setGtdEnabled = useCallback(async (v: boolean) => {
    const api = getDesktopApi();
    if (!api) return;
    const result = await api.setAppFlag('gtd-enabled', String(v));
    if (result.ok) {
      setGtdEnabledState(v);
    } else if (result.degraded) {
      setDegraded(true);
    }
  }, []);

  const addToLabel = useCallback(async (threadId: string, label: GtdLabel) => {
    const api = getDesktopApi();
    if (!api) return;
    const result = await api.setThreadLabel(threadId, label);
    if (result.ok) {
      setGtd(prev => ({ ...prev, [label]: new Set([...prev[label], threadId]) }));
    } else if (result.degraded) {
      setDegraded(true);
    }
  }, []);

  const removeFromLabel = useCallback(async (threadId: string, label: GtdLabel) => {
    const api = getDesktopApi();
    if (!api) return;
    const result = await api.unsetThreadLabel(threadId, label);
    if (result.ok) {
      setGtd(prev => {
        const next = new Set(prev[label]);
        next.delete(threadId);
        return { ...prev, [label]: next };
      });
    } else if (result.degraded) {
      setDegraded(true);
    }
  }, []);

  const moveLabel = useCallback(async (threadId: string, from: GtdLabel, to: GtdLabel) => {
    const api = getDesktopApi();
    if (!api) return;
    const result = await api.moveThreadLabel(threadId, from, to);
    if (result.ok) {
      setGtd(prev => {
        const fromSet = new Set(prev[from]);
        const toSet = new Set(prev[to]);
        fromSet.delete(threadId);
        toSet.add(threadId);
        return { ...prev, [from]: fromSet, [to]: toSet };
      });
    } else if (result.degraded) {
      setDegraded(true);
    }
  }, []);

  const togglePin = useCallback(async (threadId: string) => {
    const api = getDesktopApi();
    if (!api) return;
    if (pinned.has(threadId)) {
      const result = await api.unsetThreadLabel(threadId, 'pinned');
      if (result.ok) {
        setPinned(prev => { const next = new Set(prev); next.delete(threadId); return next; });
      }
    } else {
      const result = await api.setThreadLabel(threadId, 'pinned');
      if (result.ok) {
        setPinned(prev => new Set([...prev, threadId]));
      }
    }
  }, [pinned]);

  const removeThread = useCallback(async (threadId: string) => {
    const api = getDesktopApi();
    if (!api) return;
    // Remove from all labels
    await api.unsetThreadLabel(threadId, 'inbox');
    await api.unsetThreadLabel(threadId, 'todo');
    await api.unsetThreadLabel(threadId, 'waiting');
    await api.unsetThreadLabel(threadId, 'someday');
    await api.unsetThreadLabel(threadId, 'archived');
    await api.unsetThreadLabel(threadId, 'pinned');
    setGtd(prev => {
      const next = { ...prev };
      for (const label of Object.keys(next) as GtdLabel[]) {
        const s = new Set(next[label]);
        s.delete(threadId);
        next[label] = s;
      }
      return next;
    });
    setPinned(prev => { const s = new Set(prev); s.delete(threadId); return s; });
  }, []);

  return (
    <ThreadMetaContext.Provider value={{
      gtdEnabled,
      setGtdEnabled,
      gtd,
      pinned,
      addToLabel,
      removeFromLabel,
      moveLabel,
      togglePin,
      removeThread,
      degraded,
    }}>
      {children}
    </ThreadMetaContext.Provider>
  );
}

export function useThreadMeta(): ThreadMetaContextValue {
  const ctx = useContext(ThreadMetaContext);
  if (!ctx) throw new Error('useThreadMeta must be used within ThreadMetaProvider');
  return ctx;
}
