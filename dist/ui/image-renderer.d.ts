export type ImageProtocol = 'kitty' | 'iterm2' | null;
export interface ImageDimensions {
    width: number;
    height: number;
}
export declare function detectImageProtocol(env?: NodeJS.ProcessEnv, isTty?: boolean): ImageProtocol;
export declare function readImageDimensions(data: Buffer): ImageDimensions | null;
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
