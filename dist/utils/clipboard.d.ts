interface ImageWithDimensions {
    base64: string;
    mediaType: string;
}
/**
 * Check if clipboard contains an image (quick check without reading)
 */
export declare function hasImageInClipboard(): boolean;
/**
 * Get image from clipboard as base64
 * Returns null if no image in clipboard or on error
 */
export declare function getImageFromClipboard(): ImageWithDimensions | null;
/**
 * Save clipboard image to temp file and return path
 */
export declare function saveClipboardImageToTemp(): string | null;
export {};
