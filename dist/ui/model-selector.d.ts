import type { Config } from '../types.js';
export declare function selectModel(config: Config): Promise<{
    provider: 'claude' | 'openai' | 'custom';
    model: string;
} | null>;
