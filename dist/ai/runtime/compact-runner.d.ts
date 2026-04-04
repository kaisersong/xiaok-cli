import type { Message, ModelAdapter } from '../../types.js';
export declare class CompactRunner {
    private readonly adapter;
    constructor(adapter: ModelAdapter);
    run(messages: Message[]): Promise<string>;
}
