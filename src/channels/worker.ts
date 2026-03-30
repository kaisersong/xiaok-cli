import type { InMemoryChannelSessionStore } from './session-store.js';
import type { ChannelRequest } from './webhook.js';

export interface ChannelWorkerResult {
  accepted: true;
  sessionId: string;
}

export interface ChannelRequestExecutor {
  execute(input: ChannelRequest, sessionId: string): Promise<void> | void;
}

export async function handleChannelRequest(
  input: ChannelRequest,
  sessionStore: InMemoryChannelSessionStore,
  executor?: ChannelRequestExecutor
): Promise<ChannelWorkerResult> {
  const session = sessionStore.getOrCreate(input.sessionKey);
  await executor?.execute(input, session.sessionId);
  return {
    accepted: true,
    sessionId: session.sessionId,
  };
}
