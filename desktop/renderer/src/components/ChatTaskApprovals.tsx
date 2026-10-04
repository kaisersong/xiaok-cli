import { useEffect, useState, useSyncExternalStore } from 'react';
import type { MultiAgentDesktopAPI } from '../../../shared/multi-agent-types';
import type { MultiAgentConnection } from '../lib/multi-agent-connection';
import { useLocalExecutionAuthorization } from '../hooks/useLocalExecutionAuthorization';
import { MultiAgentApprovals } from './MultiAgentApprovals';

/** Presentation subscriber only; the existing main connection owns the facts. */
export function ChatTaskApprovals({ connection, api, sourceTaskId }: {
  connection: MultiAgentConnection; api: MultiAgentDesktopAPI; sourceTaskId?: string | null;
}) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const view = state.projection, group = view.snapshot?.group;
  const authorization = useLocalExecutionAuthorization(api);
  const [now, setNow] = useState(Date.now);
  const pending = view.snapshot?.pendingApprovals ?? [];
  useEffect(() => {
    if (!pending.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connection, group?.groupId, pending.length]);
  if (!group || group.historicalOnly || group.groupId !== view.activeGroupId
    || view.threadDeleteState !== 'none' || !sourceTaskId || view.root?.sourceTaskId !== sourceTaskId || !pending.length) return null;
  const readonly = state.phase !== 'live' || !!state.error || !!view.error || !!group.mutationBlockedReason
    || view.approvalFailure?.groupId === group.groupId || authorization.phase !== 'live'
    || authorization.authorization?.persistenceState !== 'confirmed' || !authorization.authorization.executionAllowed;
  return <MultiAgentApprovals api={api} connection={connection} threadId={connection.threadId}
    groupId={group.groupId} bootId={group.bootId} pending={pending}
    agents={[...(view.root ? [view.root] : []), ...view.agents]} readonly={readonly} now={now} />;
}
