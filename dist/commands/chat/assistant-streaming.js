export function writeAssistantTextChunkInOrder(delta, deps) {
    deps.noteVisibleAssistantText(delta);
    deps.appendAssistantText(delta);
    deps.appendStreamingSegment(delta);
    if (delta.length > 0) {
        deps.ensureStreamingPhase();
    }
    deps.writeMarkdown(delta);
}
