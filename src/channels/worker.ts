import type { InMemoryChannelSessionStore } from './session-store.js';
import type { ChannelRequest } from './webhook.js';

export interface ChannelWorkerResult {
  accepted: true;
  sessionId: string;
}

export async function handleChannelRequest(
  input: ChannelRequest,
  sessionStore: InMemoryChannelSessionStore
): Promise<ChannelWorkerResult> {
  const session = sessionStore.getOrCreate(input.sessionKey);
  return {
    accepted: true,
    sessionId: session.sessionId,
  };
}
