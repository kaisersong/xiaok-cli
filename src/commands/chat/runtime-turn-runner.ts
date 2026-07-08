export interface InteractiveTurnChunkHandlers {
  writeAssistantText(delta: string): void;
  updateUsage(usage: unknown): void;
}

export interface InteractiveRuntimeTurnRequest<Input> {
  turnToken: string;
  sessionId: string;
  cwd: string;
  source: 'chat';
  input: Input;
  signal?: AbortSignal;
}

export interface InteractiveRuntimeTurnResult {
  assistantText: string;
}

export async function runInteractiveRuntimeTurn<Input>(
  runTurn: (
    request: InteractiveRuntimeTurnRequest<Input>,
    onChunk: (chunk: unknown) => void,
    signal?: AbortSignal,
  ) => Promise<void>,
  request: InteractiveRuntimeTurnRequest<Input>,
  handlers: InteractiveTurnChunkHandlers,
): Promise<InteractiveRuntimeTurnResult> {
  let assistantText = '';

  await runTurn(request, (chunk) => {
    if (!chunk || typeof chunk !== 'object') {
      return;
    }
    const typedChunk = chunk as { type?: unknown; delta?: unknown; usage?: unknown };
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
