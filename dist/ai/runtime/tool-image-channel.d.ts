import type { ImageBlock } from './blocks.js';
export declare function validateToolImage(image: ImageBlock): {
    bytes: number;
    width: number;
    height: number;
};
/** A bounded port belongs to one invocation. No files, URLs or image bytes reach logs. */
export declare class InvocationToolImages {
    private readonly signal;
    private readonly supportsImages;
    private images;
    private bytes;
    private open;
    private readonly abort;
    constructor(signal: AbortSignal, supportsImages: boolean);
    emit: (image: ImageBlock) => void;
    finish(ok: boolean): ImageBlock[];
}
