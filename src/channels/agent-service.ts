import { Agent } from '../ai/agent.js';
import type { StreamChunk } from '../types.js';
import type { ChannelRequest } from './webhook.js';

export interface ChannelAgentSessionFactory {
  createSession(sessionId: string): Promise<{
    agent: Agent;
    dispose?(): void;
  }>;
}

export interface ChannelAgentResponder {
  reply(request: ChannelRequest, text: string, context: { sessionId: string }): Promise<void> | void;
  onError?(request: ChannelRequest, error: unknown, context: { sessionId: string }): Promise<void> | void;
}

export interface ChannelAgentExecutionResult {
  ok: boolean;
  cancelled?: boolean;
  generationMs: number;
  deliveryMs: number;
  replyLength: number;
  replyPreview?: string;
  errorMessage?: string;
}

interface SessionState {
  agent: Agent;
  dispose?: () => void;
  tail: Promise<void>;
}

export class ChannelAgentService {
  private readonly sessions = new Map<string, SessionState>();
  private readonly sessionPromises = new Map<string, Promise<SessionState>>();

  constructor(
    private readonly factory: ChannelAgentSessionFactory,
    private readonly responder: ChannelAgentResponder
  ) {}

  async execute(request: ChannelRequest, sessionId: string, signal?: AbortSignal): Promise<ChannelAgentExecutionResult> {
    const session = await this.getOrCreateSession(sessionId);
    const execution = session.tail.then(async (): Promise<ChannelAgentExecutionResult> => {
      const chunks: string[] = [];
      const generationStartedAt = Date.now();
      try {
        await session.agent.runTurn(request.message, (chunk: StreamChunk) => {
          if (chunk.type === 'text') {
            chunks.push(chunk.delta);
          }
        }, signal);

        const generationMs = Date.now() - generationStartedAt;
        const reply = chunks.join('').trim();
        if (reply) {
          const deliveryStartedAt = Date.now();
          await this.responder.reply(request, reply, { sessionId });
          return {
            ok: true,
            generationMs,
            deliveryMs: Date.now() - deliveryStartedAt,
            replyLength: reply.length,
            replyPreview: buildReplyPreview(reply),
          };
        }
        return {
          ok: true,
          generationMs,
          deliveryMs: 0,
          replyLength: 0,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || errorMessage === 'agent aborted') {
          return {
            ok: false,
            cancelled: true,
            generationMs: Date.now() - generationStartedAt,
            deliveryMs: 0,
            replyLength: 0,
            errorMessage: 'agent aborted',
          };
        }
        let deliveryMs = 0;
        if (this.responder.onError) {
          const deliveryStartedAt = Date.now();
          await this.responder.onError(request, error, { sessionId });
          deliveryMs = Date.now() - deliveryStartedAt;
        }
        return {
          ok: false,
          generationMs: Date.now() - generationStartedAt,
          deliveryMs,
          replyLength: 0,
          errorMessage,
        };
      }
    });

    session.tail = execution.then(() => undefined, () => undefined);
    await execution;
    return execution;
  }

  private async getOrCreateSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.sessionPromises.get(sessionId);
    if (pending) {
      return pending;
    }

    const createdPromise = this.factory.createSession(sessionId).then((createdSession) => {
      const created: SessionState = {
        agent: createdSession.agent,
        dispose: createdSession.dispose,
        tail: Promise.resolve(),
      };
      this.sessions.set(sessionId, created);
      this.sessionPromises.delete(sessionId);
      return created;
    }, (error) => {
      this.sessionPromises.delete(sessionId);
      throw error;
    });
    this.sessionPromises.set(sessionId, createdPromise);
    return createdPromise;
  }

  resetSession(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    this.sessionPromises.delete(sessionId);
    if (!existing) {
      return;
    }
    existing.dispose?.();
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.resetSession(sessionId);
    }
    this.sessionPromises.clear();
  }
}

function buildReplyPreview(reply: string, maxLength = 120): string {
  if (reply.length <= maxLength) return reply;
  return `${reply.slice(0, maxLength)}...`;
}
