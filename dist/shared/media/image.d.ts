export interface ImageDimensions {
    width: number;
    height: number;
}
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export declare function detectImageMediaType(data: Buffer): ImageMediaType | null;
export declare function readImageDimensions(data: Buffer): ImageDimensions | null;
export declare function readImageMetadata(data: Buffer): (ImageDimensions & {
    mediaType: ImageMediaType;
}) | null;
