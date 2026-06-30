export interface AssistantTextChunkOrderDeps {
    noteVisibleAssistantText(delta: string): void;
    appendAssistantText(delta: string): void;
    noteResponseStarted(): void;
    appendStreamingSegment(delta: string): void;
    ensureStreamingPhase(): void;
    writeMarkdown(delta: string): void;
}
export declare function writeAssistantTextChunkInOrder(delta: string, deps: AssistantTextChunkOrderDeps): void;
