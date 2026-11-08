import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSISTANT_OVERVIEW_SCHEMA, type AssistantOverviewDto } from '../../../shared/assistant-ipc-contract';
import { SCHEDULED_TASK_SCHEMA, type ScheduledTaskDto } from '../../../shared/scheduled-timed-action-ipc-contract';
import { AUTOMATION_RUN_HISTORY_SCHEMA, type AutomationRunHistoryDto } from '../../../shared/loop-current-view-ipc-contract';
import { AUTOMATION_OVERVIEW_SCHEMA, type AutomationOverviewDto } from '../../../shared/automation-config-ipc-contract';
import { getDesktopApi } from '../shared/desktop';

type Source = 'assistant' | 'schedules' | 'history' | 'automation';
interface Owner { active: boolean; busy: boolean; queued: boolean; revision: number }

/** Page read owner only. Scheduling and execution stay in Main. */
export function useAssistantWorkspace() {
  const [overview, setOverview] = useState<AssistantOverviewDto | null>(null);
  const [schedules, setSchedules] = useState<ScheduledTaskDto[] | null>(null);
  const [history, setHistory] = useState<AutomationRunHistoryDto[] | null>(null);
  const [automation, setAutomation] = useState<AutomationOverviewDto | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Source, boolean>>>({});
  const [reading, setReading] = useState(true);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [operationUnknown, setOperationUnknown] = useState(false);
  const life = useRef<Owner | null>(null);
  const mutationLock = useRef(false);
  const requestRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => {
    const owner = life.current;
    if (!owner?.active) return;
    if (owner.busy || mutationLock.current) { owner.queued = true; return; }
    owner.busy = true; setReading(true);
    const revision = owner.revision;
    const current = () => owner.active && life.current === owner && owner.revision === revision;
    const desktop = getDesktopApi();
    async function read<T>(source: Source, load: () => Promise<T>, commit: (value: T | null) => void) {
      try {
        const value = await load();
        if (!current()) return;
        commit(value); setErrors(old => ({ ...old, [source]: false }));
        if (source === 'assistant') setOperationUnknown(false);
      } catch {
        if (!current()) return;
        commit(null); setErrors(old => ({ ...old, [source]: true }));
      }
    }
    void Promise.allSettled([
      read('assistant', async () => ASSISTANT_OVERVIEW_SCHEMA.parse(await desktop!.getAssistantOverview()), setOverview),
      read('schedules', async () => SCHEDULED_TASK_SCHEMA.array().parse(await desktop!.getScheduledTasks()), setSchedules),
      read('history', async () => AUTOMATION_RUN_HISTORY_SCHEMA.array().parse(await desktop!.getAutomationRunHistory()), setHistory),
      read('automation', async () => AUTOMATION_OVERVIEW_SCHEMA.parse(await desktop!.getAutomationOverviewSnapshot()), setAutomation),
    ]).finally(() => {
      if (!owner.active || life.current !== owner) return;
      owner.busy = false; setReading(false);
      if (owner.queued && !mutationLock.current) { owner.queued = false; requestRef.current(); }
    });
  }, []);
  requestRef.current = refresh;

  useEffect(() => {
    const owner: Owner = { active: true, busy: false, queued: false, revision: 0 };
    life.current = owner; refresh();
    const stop = getDesktopApi()?.onScheduledTaskDue?.(() => refresh());
    const stopAssistant = getDesktopApi()?.onAssistantInboxChanged?.(refresh);
    window.addEventListener('xiaok:scheduled-tasks-updated', refresh);
    return () => { owner.active = false; owner.queued = false; stop?.(); stopAssistant?.(); window.removeEventListener('xiaok:scheduled-tasks-updated', refresh); };
  }, [refresh]);

  const mutate = useCallback(async (action: () => Promise<unknown>) => {
    const owner = life.current;
    if (!owner?.active || mutationLock.current) return;
    mutationLock.current = true; owner.revision++; setMutationBusy(true);
    try {
      await action();
      if (owner.active && life.current === owner) { setOperationUnknown(false); owner.queued = true; }
    } catch {
      if (owner.active && life.current === owner) setOperationUnknown(true);
    } finally {
      mutationLock.current = false;
      if (owner.active && life.current === owner) {
        setMutationBusy(false);
        if (owner.queued && !owner.busy) { owner.queued = false; refresh(); }
      }
    }
  }, [refresh]);
  return { overview, schedules, history, automation, errors, reading, refresh, mutate, mutationBusy, operationUnknown };
}
