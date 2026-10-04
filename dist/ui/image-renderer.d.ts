import { type ImageDimensions } from '../shared/media/image.js';
export { readImageDimensions } from '../shared/media/image.js';
export type { ImageDimensions } from '../shared/media/image.js';
export type ImageProtocol = 'kitty' | 'iterm2' | null;
export declare function detectImageProtocol(env?: NodeJS.ProcessEnv, isTty?: boolean): ImageProtocol;
export declare function formatImagePlaceholder(dims: ImageDimensions | null): string;
export declare function formatImageFallbackLine(dims: ImageDimensions | null): string;
export declare function renderImageLines(opts: {
    data: Buffer;
    mediaType: string;
    protocol?: ImageProtocol;
    maxCols?: number;
    maxRows?: number;
    columns?: number;
    imageId?: number;
}): {
    lines: string[];
    rows: number;
    cols: number;
    protocol: ImageProtocol;
};
