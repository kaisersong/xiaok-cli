import type { Config } from '../types.js';
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
export declare function buildModelOptions(config: Config): ModelOption[];
export declare function selectModel(config: Config, options?: ModelSelectorOptions): Promise<{
    modelId: string;
    provider: string;
    model: string;
    label: string;
} | null>;
export {};
