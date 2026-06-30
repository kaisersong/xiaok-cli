export interface AssistantTextChunkOrderDeps {
  noteVisibleAssistantText(delta: string): void;
  appendAssistantText(delta: string): void;
  noteResponseStarted(): void;
  appendStreamingSegment(delta: string): void;
  ensureStreamingPhase(): void;
  writeMarkdown(delta: string): void;
}

export function writeAssistantTextChunkInOrder(
  delta: string,
  deps: AssistantTextChunkOrderDeps,
): void {
  deps.noteVisibleAssistantText(delta);
  deps.appendAssistantText(delta);
  if (/\S/.test(delta)) {
    deps.noteResponseStarted();
  }
  deps.appendStreamingSegment(delta);
  if (delta.length > 0) {
    deps.ensureStreamingPhase();
  }
  deps.writeMarkdown(delta);
}
