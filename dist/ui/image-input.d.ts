import type { MessageBlock } from '../types.js';
export declare function setPastedImagePath(index: number, path: string): void;
export declare function clearPastedImagePaths(): void;
export declare function parseInputBlocks(input: string, supportsImages: boolean): Promise<MessageBlock[]>;
