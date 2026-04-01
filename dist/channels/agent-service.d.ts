import { Agent } from '../ai/agent.js';
import type { AgentSessionSnapshot } from '../ai/runtime/session.js';
import type { RuntimeFacade } from '../ai/runtime/runtime-facade.js';
import type { ChannelRequest } from './webhook.js';
export interface ChannelAgentSessionFactory {
    createSession(sessionId: string): Promise<{
        agent: Agent;
        runtimeFacade?: RuntimeFacade;
        cwd?: string;
        dispose?(): void;
    }>;
}
export interface ChannelAgentResponder {
    reply(request: ChannelRequest, text: string, context: {
        sessionId: string;
    }): Promise<void> | void;
    onError?(request: ChannelRequest, error: unknown, context: {
        sessionId: string;
    }): Promise<void> | void;
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
export declare class ChannelAgentService {
    private readonly factory;
    private readonly responder;
    private readonly sessions;
    private readonly sessionPromises;
    constructor(factory: ChannelAgentSessionFactory, responder: ChannelAgentResponder);
    execute(request: ChannelRequest, sessionId: string, signal?: AbortSignal): Promise<ChannelAgentExecutionResult>;
    private getOrCreateSession;
    resetSession(sessionId: string): void;
    closeAll(): void;
    getSessionSnapshot(sessionId: string): AgentSessionSnapshot | undefined;
}
