export async function handleChannelRequest(input, sessionStore) {
    const session = sessionStore.getOrCreate(input.sessionKey);
    return {
        accepted: true,
        sessionId: session.sessionId,
    };
}
