import { useEffect, useState, type ReactNode } from 'react';
import { projectPublicTaskMessages } from '../../../shared/context-continuity-projection';
import type { ScheduledActionDto, ScheduledRunDto } from '../../../shared/scheduled-timed-action-ipc-contract';
import { api } from '../api';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { MarkdownRenderer } from './MarkdownRenderer';

const timestamp = (value: number) => new Date(value).toLocaleString();
const fieldClass = 'max-w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] p-1.5 text-[var(--c-text-primary)]';

export function ScheduledRunHistory({ title, fallback }: { title: string; fallback: ReactNode }) {
  const { t } = useLocale();
  const [candidates, setCandidates] = useState<ScheduledActionDto[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    const desktop = getDesktopApi();
    if (!desktop?.getTimedActions || !desktop.getTimedActionRuns || !title) return;
    let current = true;
    desktop.getTimedActions().then(actions => {
      if (!current) return;
      setCandidates(actions.filter(action => action.executor.kind === 'agent_task' && action.runCount > 0
        && (action.title === title || action.title.slice(0, 40) === title)));
    }).catch(() => {
      if (current) setCandidates([]);
    });
    return () => { current = false; };
  }, [title]);

  if (!candidates.length) return fallback;

  const action = candidates.find(candidate => candidate.id === selected);
  return (
    <section className="mx-auto max-w-[800px] space-y-3 px-14 py-8 text-sm text-[var(--c-text-secondary)]">
      <h2 className="font-medium text-[var(--c-text-primary)]">{t.scheduledHistory.title}</h2>
      {candidates.length === 1 ? (
        <button type="button" className="text-[var(--c-accent)] hover:underline" onClick={() => setSelected(candidates[0].id)}>
          {t.scheduledHistory.open(candidates[0].title)}
        </button>
      ) : (
        <label className="flex flex-wrap items-center gap-2">
          {t.scheduledHistory.choose}
          <select className={fieldClass} value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="" disabled>{t.scheduledHistory.choose}</option>
            {candidates.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title} · {t.scheduledHistory.created(timestamp(candidate.createdAt))}
              </option>
            ))}
          </select>
        </label>
      )}
      {action && <ScheduleRuns key={action.id} actionId={action.id} />}
    </section>
  );
}

function ScheduleRuns({ actionId }: { actionId: string }) {
  const { t } = useLocale();
  const [runs, setRuns] = useState<ScheduledRunDto[]>();
  const [selected, setSelected] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const desktop = getDesktopApi();
    if (!desktop?.getTimedActionRuns) return;
    let current = true;
    desktop.getTimedActionRuns(actionId).then(rows => {
      if (!current) return;
      const ordered = rows.filter(row => row.actionId === actionId && row.executorKind === 'agent_task')
        .sort((first, second) => second.startedAt - first.startedAt);
      setRuns(ordered);
      setSelected((ordered.find(run => run.runtimeTaskId) ?? ordered[0])?.runId ?? '');
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [actionId, attempt]);

  if (failed) return (
    <div role="alert">
      <p>{t.scheduledHistory.unavailable}</p>
      <button type="button" className="text-[var(--c-accent)] hover:underline" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>
        {t.automationsReadRetry}
      </button>
    </div>
  );
  if (!runs) return <p role="status">{t.commonLoading}</p>;
  if (!runs.length) return <p>{t.scheduledHistory.empty}</p>;
  const run = runs.find(item => item.runId === selected);
  return (
    <>
      <label className="flex flex-wrap items-center gap-2">
        {t.scheduledHistory.runs}
        <select className={fieldClass} value={selected} onChange={event => setSelected(event.target.value)}>
          {runs.map(item => <option key={item.runId} value={item.runId}>{timestamp(item.startedAt)}</option>)}
        </select>
      </label>
      {run?.runtimeTaskId
        ? <SavedRunOutput key={run.runtimeTaskId} taskId={run.runtimeTaskId} />
        : <p>{t.scheduledHistory.noOutput}</p>}
    </>
  );
}

async function readRunOutput(taskId: string) {
  if (api.hasLocalLegacyTaskArchive()) {
    // Bound executions are handled by the separately authorized history port.
    const archive = await api.readLocalLegacyTaskArchive(taskId).catch(() => null);
    if (archive) {
      if (archive.taskId !== taskId) throw new Error('task_history_unavailable');
      return archive.messages;
    }
  }
  const history = await api.readTaskHistory(taskId);
  if (history.snapshot.taskId !== taskId) throw new Error('task_history_unavailable');
  return projectPublicTaskMessages({ ...history.snapshot, prompt: '' }).filter(message => message.role === 'assistant');
}

function SavedRunOutput({ taskId }: { taskId: string }) {
  const { t } = useLocale();
  const [messages, setMessages] = useState<Awaited<ReturnType<typeof readRunOutput>>>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    readRunOutput(taskId).then(value => {
      if (current) setMessages(value);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [taskId]);

  if (failed) return <p role="alert">{t.scheduledHistory.unavailable}</p>;
  if (!messages) return <p role="status">{t.commonLoading}</p>;
  if (!messages.length) return <p>{t.scheduledHistory.noOutput}</p>;
  return (
    <div className="space-y-4 break-words text-[var(--c-text-primary)]">
      {messages.map(message => <MarkdownRenderer key={message.sourceMessageId} content={message.text} />)}
    </div>
  );
}
