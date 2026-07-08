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
export declare function runInteractiveRuntimeTurn<Input>(runTurn: (request: InteractiveRuntimeTurnRequest<Input>, onChunk: (chunk: unknown) => void, signal?: AbortSignal) => Promise<void>, request: InteractiveRuntimeTurnRequest<Input>, handlers: InteractiveTurnChunkHandlers): Promise<InteractiveRuntimeTurnResult>;
