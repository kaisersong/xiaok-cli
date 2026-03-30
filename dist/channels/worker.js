export async function handleChannelRequest(input, sessionStore, executor) {
    const session = sessionStore.getOrCreate(input.sessionKey);
    await executor?.execute(input, session.sessionId);
    return {
        accepted: true,
        sessionId: session.sessionId,
    };
}
