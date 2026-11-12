import {ASSISTANT_ACTION_OVERVIEW_SCHEMA,type AssistantActionOverviewDto} from '../../../shared/assistant-ipc-contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSISTANT_OVERVIEW_SCHEMA, type AssistantOverviewDto } from '../../../shared/assistant-ipc-contract';
import { SCHEDULED_TASK_SCHEMA, type ScheduledTaskDto } from '../../../shared/scheduled-timed-action-ipc-contract';
import { AUTOMATION_RUN_HISTORY_SCHEMA, type AutomationRunHistoryDto } from '../../../shared/loop-current-view-ipc-contract';
import { AUTOMATION_OVERVIEW_SCHEMA, type AutomationOverviewDto } from '../../../shared/automation-config-ipc-contract';
import { getDesktopApi } from '../shared/desktop';

type Source = 'product' | 'assistant' | 'schedules' | 'history' | 'automation';
interface Owner { active: boolean; busy: boolean; queued: boolean; revision: number }
export type MutationExpectation = (overview: AssistantOverviewDto) => boolean;
/** Delay before the single automatic read-back after an unknown mutation result. */
export const AUTO_RECHECK_DELAY_MS = 600;

/** Page read owner only. Scheduling and execution stay in Main. */
export function useAssistantWorkspace() {
  const [product,setProduct]=useState<AssistantActionOverviewDto|null>(null);
  const [overview, setOverview] = useState<AssistantOverviewDto | null>(null);
  const [schedules, setSchedules] = useState<ScheduledTaskDto[] | null>(null);
  const [history, setHistory] = useState<AutomationRunHistoryDto[] | null>(null);
  const [automation, setAutomation] = useState<AutomationOverviewDto | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Source, boolean>>>({});
  const [reading, setReading] = useState(true);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [operationUnknown, setOperationUnknown] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [mutationOutcome, setMutationOutcome] = useState<'applied' | 'not_applied' | null>(null);
  const life = useRef<Owner | null>(null);
  const mutationLock = useRef(false);
  const pendingExpectation = useRef<MutationExpectation | null>(null);
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<() => void>(() => {});
  const clearRecheck = useCallback(() => {
    if (recheckTimer.current !== null) { clearTimeout(recheckTimer.current); recheckTimer.current = null; }
    pendingExpectation.current = null;
  }, []);
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
        if (source === 'assistant') {
          setOperationUnknown(false);
          const expectation = pendingExpectation.current;
          if (expectation) {
            if (recheckTimer.current !== null) { clearTimeout(recheckTimer.current); recheckTimer.current = null; }
            pendingExpectation.current = null; setRechecking(false);
            // The 'assistant' source is only ever read with AssistantOverviewDto.
            setMutationOutcome(expectation(value as AssistantOverviewDto) ? 'applied' : 'not_applied');
          }
        }
      } catch {
        if (!current()) return;
        commit(null); setErrors(old => ({ ...old, [source]: true }));
        if (source === 'assistant' && pendingExpectation.current) {
          clearRecheck(); setRechecking(false); setOperationUnknown(true);
        }
      }
    }
    void Promise.allSettled([
      read('product',async()=>ASSISTANT_ACTION_OVERVIEW_SCHEMA.parse(await desktop!.getAssistantActionOverview()),setProduct),
      read('assistant', async () => ASSISTANT_OVERVIEW_SCHEMA.parse(await desktop!.getAssistantOverview()), setOverview),
      read('schedules', async () => SCHEDULED_TASK_SCHEMA.array().parse(await desktop!.getScheduledTasks()), setSchedules),
      read('history', async () => AUTOMATION_RUN_HISTORY_SCHEMA.array().parse(await desktop!.getAutomationRunHistory()), setHistory),
      read('automation', async () => AUTOMATION_OVERVIEW_SCHEMA.parse(await desktop!.getAutomationOverviewSnapshot()), setAutomation),
    ]).finally(() => {
      if (!owner.active || life.current !== owner) return;
      owner.busy = false; setReading(false);
      if (owner.queued && !mutationLock.current) { owner.queued = false; requestRef.current(); }
    });
  }, [clearRecheck]);
  requestRef.current = refresh;

  useEffect(() => {
    const owner: Owner = { active: true, busy: false, queued: false, revision: 0 };
    life.current = owner; refresh();
    const stop = getDesktopApi()?.onScheduledTaskDue?.(() => refresh());
    const stopAssistant = getDesktopApi()?.onAssistantInboxChanged?.(refresh);
    window.addEventListener('xiaok:scheduled-tasks-updated', refresh);
    return () => { owner.active = false; owner.queued = false; if (recheckTimer.current !== null) clearTimeout(recheckTimer.current); stop?.(); stopAssistant?.(); window.removeEventListener('xiaok:scheduled-tasks-updated', refresh); };
  }, [refresh]);

  /** Never replays a mutation. On an unknown result it schedules one read-back
   * and reports the checked outcome instead of asking the user to verify. */
  const mutate = useCallback(async (action: () => Promise<unknown>, expectApplied?: MutationExpectation) => {
    const owner = life.current;
    if (!owner?.active || mutationLock.current) return;
    clearRecheck(); setMutationOutcome(null);
    mutationLock.current = true; owner.revision++; setMutationBusy(true);
    try {
      await action();
      if (owner.active && life.current === owner) { setOperationUnknown(false); owner.queued = true; }
    } catch {
      if (owner.active && life.current === owner) {
        if (expectApplied) {
          pendingExpectation.current = expectApplied;
          setRechecking(true);
          // If another read is in flight when the timer fires, the timer waits
          // instead of queueing a second read; that read consumes the
          // expectation or clears it.
          const scheduleRecheck = () => {
            recheckTimer.current = setTimeout(() => {
              recheckTimer.current = null;
              const expectation = pendingExpectation.current;
              if (!owner.active || life.current !== owner || expectation !== expectApplied) return;
              if (owner.busy || mutationLock.current) { scheduleRecheck(); return; }
              refresh();
            }, AUTO_RECHECK_DELAY_MS);
          };
          scheduleRecheck();
        } else setOperationUnknown(true);
      }
    } finally {
      mutationLock.current = false;
      if (owner.active && life.current === owner) {
        setMutationBusy(false);
        if (owner.queued && !owner.busy) { owner.queued = false; refresh(); }
      }
    }
  }, [clearRecheck, refresh]);
  return { product, overview, schedules, history, automation, errors, reading, refresh, mutate, mutationBusy, operationUnknown, rechecking, mutationOutcome, clearMutationOutcome: setMutationOutcome };
}
