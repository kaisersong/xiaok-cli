import { useSyncExternalStore } from 'react';
import type { MultiAgentDesktopAPI } from '../../../shared/multi-agent-types';
import { localExecutionAuthorization, unavailableLocalExecutionState } from '../lib/local-execution-authorization';
const noopSubscribe = () => () => {};
const unavailableSnapshot = () => unavailableLocalExecutionState;
export function useLocalExecutionAuthorization(api: MultiAgentDesktopAPI | undefined) {
  const connection = localExecutionAuthorization(api);
  const state = useSyncExternalStore(connection?.subscribe ?? noopSubscribe, connection?.getSnapshot ?? unavailableSnapshot);
  return { connection, ...state };
}
