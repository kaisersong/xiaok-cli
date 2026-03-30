import { Agent } from '../ai/agent.js';
import type { StreamChunk } from '../types.js';
import type { ChannelRequest } from './webhook.js';

export interface ChannelAgentSessionFactory {
  createAgent(): Agent;
}

export interface ChannelAgentResponder {
  reply(request: ChannelRequest, text: string): Promise<void> | void;
  onError?(request: ChannelRequest, error: unknown): Promise<void> | void;
}

export interface ChannelAgentExecutionResult {
  ok: boolean;
  generationMs: number;
  deliveryMs: number;
  replyLength: number;
  errorMessage?: string;
}

interface SessionState {
  agent: Agent;
  tail: Promise<void>;
}

export class ChannelAgentService {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly factory: ChannelAgentSessionFactory,
    private readonly responder: ChannelAgentResponder
  ) {}

  async execute(request: ChannelRequest, sessionId: string): Promise<ChannelAgentExecutionResult> {
    const session = this.getOrCreateSession(sessionId);
    const execution = session.tail.then(async (): Promise<ChannelAgentExecutionResult> => {
      const chunks: string[] = [];
      const generationStartedAt = Date.now();
      try {
        await session.agent.runTurn(request.message, (chunk: StreamChunk) => {
          if (chunk.type === 'text') {
            chunks.push(chunk.delta);
          }
        });

        const generationMs = Date.now() - generationStartedAt;
        const reply = chunks.join('').trim();
        if (reply) {
          const deliveryStartedAt = Date.now();
          await this.responder.reply(request, reply);
          return {
            ok: true,
            generationMs,
            deliveryMs: Date.now() - deliveryStartedAt,
            replyLength: reply.length,
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
        let deliveryMs = 0;
        if (this.responder.onError) {
          const deliveryStartedAt = Date.now();
          await this.responder.onError(request, error);
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

  private getOrCreateSession(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionState = {
      agent: this.factory.createAgent(),
      tail: Promise.resolve(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }
}
