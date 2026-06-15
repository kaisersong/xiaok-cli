import { type CompiledA2UIArtifact, type RenderUIInput } from './protocol.js';
export interface CompileRenderUiContext {
    taskId: string;
    toolUseId: string;
}
export declare function compileRenderUiToA2ui(input: RenderUIInput, context: CompileRenderUiContext): CompiledA2UIArtifact;
