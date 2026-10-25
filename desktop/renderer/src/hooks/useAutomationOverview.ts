import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { AUTOMATION_OVERVIEW_SCHEMA, type AutomationOverviewDto } from '../../../shared/automation-config-ipc-contract';
/** One page read owner, shared by initial/manual/history refreshes. */
export function useAutomationOverview() {
  const [snapshot, setSnapshot] = useState<AutomationOverviewDto | null>(null);
  const [readFailed, setReadFailed] = useState(false), [reading, setReading] = useState(false);
  const life = useRef<{ active: boolean; busy: boolean; queued: boolean } | null>(null);
  const revision = useRef(0), requestRef = useRef<(manual?: boolean) => void>(() => {});
  const request = useCallback((manual = true) => {
    const owner = life.current;
    if (!owner?.active) return;
    if (owner.busy) { if (manual) owner.queued = true; return; }
    owner.busy = true; setReading(true); const admittedRevision = revision.current;
    void (async () => {
      try {
        const value = await api.getAutomationOverviewSnapshot();
        if (!owner.active || life.current !== owner || admittedRevision !== revision.current) return;
        const parsed = AUTOMATION_OVERVIEW_SCHEMA.safeParse(value);
        if (!parsed.success) throw Error('automation_config_operation_unknown');
        setSnapshot(parsed.data); setReadFailed(false);
      } catch {
        if (owner.active && life.current === owner && admittedRevision === revision.current) setReadFailed(true);
      } finally {
        if (owner.active && life.current === owner) {
          owner.busy = false; setReading(false);
          if (owner.queued) { owner.queued = false; requestRef.current(false); }
        }
      }
    })();
  }, []);
  requestRef.current = request;
  useEffect(() => {
    const owner = { active: true, busy: false, queued: false }; life.current = owner; request(false);
    return () => { owner.active = false; owner.queued = false; };
  }, [request]);
  const beginMutation = useCallback(() => { revision.current++; }, []);
  const commitFlag = useCallback((enabled: boolean) => {
    revision.current++;
    setSnapshot(current => current ? { ...current, globalBackgroundAutoRunEnabled: enabled } : current);
  }, []);
  return { snapshot, readFailed, reading, refresh: request, beginMutation, commitFlag };
}
