import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getDesktopApi } from '../shared/desktop';
import { MultiAgentConnection, type MultiAgentConnectionSummary } from '../lib/multi-agent-connection';
import { MultiAgentThreadFacts } from '../lib/multi-agent-projection';

const unavailable: MultiAgentConnectionSummary = { total: 0, running: 0, failed: 0, error: true, phase: 'error',
  hasAgentHistory: false, needsRecovery: false, historicalSelection: false, deleted: false, pendingApprovalCount: 0 };
const getUnavailable = () => unavailable;
const noSubscribe = () => () => {};

export function useMultiAgentConnection(threadId?: string, groupId?: string) {
  const api = getDesktopApi();
  const facts = useMemo(() => new MultiAgentThreadFacts(threadId ?? ''), [api, threadId]);
  const connection = useMemo(() => threadId && typeof api?.subscribeMultiAgents === 'function'
    ? new MultiAgentConnection(api, threadId, groupId, facts) : null, [api, threadId, groupId, facts]);
  useEffect(() => connection?.start(), [connection]);
  // The ChatShell only observes the small summary. Child output changes update
  // MultiAgentPanel, not the main transcript and composer subtree.
  const summary = useSyncExternalStore(connection?.subscribe ?? noSubscribe, connection?.getSummary ?? getUnavailable);
  return { connection, api, summary };
}
