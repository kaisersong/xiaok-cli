import type { LoopRunView } from '../../api/types';

export function getLoopRunStatusLabel(status: LoopRunView['status']): string {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  return 'running';
}

export function formatLoopRunTime(run: LoopRunView): string {
  const ts = run.finishedAt ?? run.updatedAt ?? run.startedAt;
  return new Date(ts).toLocaleString();
}
