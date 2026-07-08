export async function runInteractiveRuntimeTurn(runTurn, request, handlers) {
    let assistantText = '';
    await runTurn(request, (chunk) => {
        if (!chunk || typeof chunk !== 'object') {
            return;
        }
        const typedChunk = chunk;
        if (typedChunk.type === 'text' && typeof typedChunk.delta === 'string') {
            assistantText += typedChunk.delta;
            handlers.writeAssistantText(typedChunk.delta);
            return;
        }
        if (typedChunk.type === 'usage') {
            handlers.updateUsage(typedChunk.usage);
        }
    }, request.signal);
    return { assistantText };
}
