import type { Config } from '../types.js';
import type { ModelReasoningEffort } from '../ai/providers/types.js';
import type { ReplRenderer } from './repl-renderer.js';
interface ModelOption {
    id: string;
    provider: string;
    model: string;
    label: string;
    desc: string;
}
interface ModelSelectorOptions {
    renderer?: ReplRenderer;
}
type SelectedModel = {
    modelId: string;
    provider: string;
    model: string;
    label: string;
    reasoningEffort?: ModelReasoningEffort;
};
export declare function buildModelOptions(config: Config): ModelOption[];
export declare function selectModel(config: Config, options?: ModelSelectorOptions): Promise<SelectedModel | null>;
export {};
