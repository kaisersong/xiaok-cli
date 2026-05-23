export interface InputPasteChunkResult {
    handled: boolean;
    placeholder?: string;
}
export interface InputPasteController {
    handleChunk(raw: string): InputPasteChunkResult;
    importClipboardImage(): string | null;
}
export interface InputPasteControllerOptions {
    clipboardImageSaver: () => string | null;
    platform?: string;
}
export declare function createInputPasteController(options: InputPasteControllerOptions): InputPasteController;
