import type { Message, ModelAdapter } from '../../types.js';
import type { StreamOptions } from './model-capabilities.js';
export declare class CompactRunner {
    private readonly adapter;
    constructor(adapter: ModelAdapter);
    run(messages: Message[], streamOptions?: StreamOptions, onProgress?: () => void): Promise<string>;
}
