export class ChannelAgentService {
    factory;
    responder;
    sessions = new Map();
    sessionPromises = new Map();
    constructor(factory, responder) {
        this.factory = factory;
        this.responder = responder;
    }
    async execute(request, sessionId, signal) {
        const session = await this.getOrCreateSession(sessionId);
        const execution = session.tail.then(async () => {
            const chunks = [];
            const generationStartedAt = Date.now();
            try {
                await session.agent.runTurn(request.message, (chunk) => {
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
            }
            catch (error) {
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
    async getOrCreateSession(sessionId) {
        const existing = this.sessions.get(sessionId);
        if (existing) {
            return existing;
        }
        const pending = this.sessionPromises.get(sessionId);
        if (pending) {
            return pending;
        }
        const createdPromise = this.factory.createSession(sessionId).then((createdSession) => {
            const created = {
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
    resetSession(sessionId) {
        const existing = this.sessions.get(sessionId);
        this.sessionPromises.delete(sessionId);
        if (!existing) {
            return;
        }
        existing.dispose?.();
        this.sessions.delete(sessionId);
    }
    closeAll() {
        for (const sessionId of [...this.sessions.keys()]) {
            this.resetSession(sessionId);
        }
        this.sessionPromises.clear();
    }
}
function buildReplyPreview(reply, maxLength = 120) {
    if (reply.length <= maxLength)
        return reply;
    return `${reply.slice(0, maxLength)}...`;
}
