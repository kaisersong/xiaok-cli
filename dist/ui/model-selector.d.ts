import type { Config } from '../types.js';
interface ModelOption {
    id: string;
    provider: string;
    model: string;
    label: string;
    desc: string;
}
export declare function buildModelOptions(config: Config): ModelOption[];
export declare function selectModel(config: Config): Promise<{
    modelId: string;
    provider: string;
    model: string;
    label: string;
} | null>;
export {};
