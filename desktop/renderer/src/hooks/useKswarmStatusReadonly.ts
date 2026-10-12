import { useCallback, useEffect, useRef, useState } from 'react';
import { getDesktopApi } from '../shared/desktop';
import { KSWARM_STATUS_SCHEMA, type KswarmReadonlyStatus } from '../../../shared/runtime-status-readonly-ipc-contract';
type Owner = { active: boolean; busy: boolean; queued: boolean; events: number };
export function useKswarmStatusReadonly() {
  const [data, setData] = useState<KswarmReadonlyStatus | null>(null), [failed, setFailed] = useState(false), [reading, setReading] = useState(true);
  const lifetime = useRef<Owner | null>(null);
  const runRef = useRef<(owner: Owner) => void>(() => {});
  const run = useCallback((owner: Owner) => {
    if (!owner.active || lifetime.current !== owner) return;
    owner.busy = true; setReading(true); const events = owner.events;
    void (async () => {
      try {
        const desktop = getDesktopApi();
        if (!desktop?.kswarmGetStatus) throw Error('runtime_status_runtime_unavailable');
        const value = await desktop.kswarmGetStatus(), parsed = KSWARM_STATUS_SCHEMA.safeParse(value);
        if (!parsed.success) throw Error('runtime_status_projection_unavailable');
        if (owner.active && lifetime.current === owner && owner.events === events) { setData(parsed.data); setFailed(false); }
      } catch {
        if (owner.active && lifetime.current === owner && owner.events === events) setFailed(true);
      } finally {
        if (owner.active && lifetime.current === owner) {
          owner.busy = false; setReading(false);
          if (owner.queued) { owner.queued = false; runRef.current(owner); }
        }
      }
    })();
  }, []);
  runRef.current = run;
  const refresh = useCallback(() => {
    const owner = lifetime.current;
    if (!owner?.active) return;
    if (owner.busy) { owner.queued = true; return; }
    runRef.current(owner);
  }, []);
  useEffect(() => {
    const owner: Owner = { active: true, busy: false, queued: false, events: 0 }; lifetime.current = owner;
    let unsubscribe: (() => void) | undefined;
    try {
      const desktop = getDesktopApi();
      if (desktop?.onKSwarmStatus) unsubscribe = desktop.onKSwarmStatus(value => {
        if (!owner.active || lifetime.current !== owner) return;
        owner.events++;
        const parsed = KSWARM_STATUS_SCHEMA.safeParse(value);
        if (!parsed.success) { setFailed(true); return; }
        setData(parsed.data); setFailed(false);
      });
    } catch { setFailed(true); }
    refresh();
    return () => { owner.active = false; owner.queued = false; unsubscribe?.(); };
  }, [refresh]);
  return { data, failed, reading, refresh };
}
