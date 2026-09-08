import { useSyncExternalStore } from 'react';
import { useLocale } from '../contexts/LocaleContext';
import type { MultiAgentConnection } from '../lib/multi-agent-connection';

const noSubscribe = () => () => {};
const noSnapshot = () => null;

/** Local Codex uses the standard task stream; other tasks use the agent push subscription. */
export function ChatExecutionStatus({ connection, sourceTaskId }: {
  connection?: MultiAgentConnection | null; sourceTaskId?: string | null;
}) {
  const { t } = useLocale();
  const state = useSyncExternalStore(connection?.subscribe ?? noSubscribe, connection?.getSnapshot ?? noSnapshot);
  const view = state?.projection;
  const group = view?.snapshot?.group;
  const root = view?.root;
  let label = t.chatView.executionSyncing;
  if (sourceTaskId?.startsWith('task_codex_')) label = t.chatView.executionRunning;
  else if (state?.phase === 'error' || state?.error || view?.error) label = t.chatView.executionDisconnected;
  else if (state?.phase === 'live' && group && !group.historicalOnly && group.groupId === view?.activeGroupId
    && view.threadDeleteState === 'none' && sourceTaskId && root?.sourceTaskId === sourceTaskId) {
    const approval = view.snapshot?.pendingApprovals?.some(item => item.agentId === root.id
      && item.turn === root.turn && item.turnId === root.turnId && item.status === 'pending');
    if (approval) label = t.chatView.executionApproval;
    else if (root.status === 'pending') label = t.chatView.executionQueued;
    else if (root.status === 'running' && root.executionActive) label = t.chatView.executionRunning;
    else if (root.status === 'completed') label = t.chatView.executionFinishing;
  }
  return <span role="status" className="text-sm text-[var(--c-text-secondary)]">{label}</span>;
}
