import type { NavigateFunction } from 'react-router-dom';

const THREAD_OPEN_AT = 'threadOpenAt';

/** Navigate to a conversation and bump a reopen token so a second click on the current route reloads. */
export function openConversation(navigate: NavigateFunction, threadId: string, state?: Record<string, unknown>) {
  navigate(`/t/${threadId}`, { state: { ...state, [THREAD_OPEN_AT]: Date.now() } });
}

export function conversationOpenAt(state: unknown): number | undefined {
  if (!state || typeof state !== 'object' || !(THREAD_OPEN_AT in state)) return undefined;
  const value = (state as { threadOpenAt: unknown }).threadOpenAt;
  return typeof value === 'number' ? value : undefined;
}
