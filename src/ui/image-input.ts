import { existsSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';
import type { MessageBlock } from '../types.js';

const IMAGE_MIME_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function normalizeInputPath(input: string): string {
  return input.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Parse [Image #x] references from input text and extract image paths.
 * Returns a map of image reference to file path.
 */
function parseImageReferences(input: string): Map<number, string> {
  const imageRefs = new Map<number, string>();
  const imagePattern = /\[Image #(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(input)) !== null) {
    const imageNum = parseInt(match[1], 10);
    // Image files are stored in /tmp/xiaok_pasted_*.png
    // We need to find the actual file - for now we'll use a placeholder
    // In a real implementation, you'd track the file paths in input.ts
    imageRefs.set(imageNum, match[0]); // Placeholder - will be replaced below
  }

  return imageRefs;
}

/**
 * Track pasted images for the current input session.
 * This is populated by input.ts when images are pasted.
 */
let pastedImagePaths: Map<number, string> = new Map();

export function setPastedImagePath(index: number, path: string): void {
  pastedImagePaths.set(index, path);
}

export function clearPastedImagePaths(): void {
  pastedImagePaths = new Map();
}

export async function parseInputBlocks(input: string, supportsImages: boolean): Promise<MessageBlock[]> {
  const blocks: MessageBlock[] = [];
  const normalized = normalizeInputPath(input);
  const extension = extname(normalized).toLowerCase();
  const mediaType = IMAGE_MIME_TYPES[extension];

  // Check if it's a direct file path
  if (mediaType && existsSync(normalized)) {
    if (!supportsImages) {
      throw new Error('当前模型不支持图片输入');
    }

    const absolutePath = resolve(normalized);
    const data = readFileSync(absolutePath).toString('base64');

    return [{
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data,
      },
    }];
  }

  // Parse [Image #x] references
  const imagePattern = /\[Image #(\d+)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let hasText = false;

  while ((match = imagePattern.exec(input)) !== null) {
    const imageNum = parseInt(match[1], 10);
    const imagePath = pastedImagePaths.get(imageNum);

    // Add text before this image reference
    if (match.index > lastIndex) {
      const textBefore = input.slice(lastIndex, match.index).trim();
      if (textBefore) {
        hasText = true;
        blocks.push({ type: 'text', text: textBefore });
      }
    }

    // Add image if file exists
    if (imagePath && existsSync(imagePath)) {
      if (!supportsImages) {
        throw new Error('当前模型不支持图片输入');
      }

      const data = readFileSync(imagePath).toString('base64');
      const imgExt = extname(imagePath).toLowerCase();
      const imgMediaType = IMAGE_MIME_TYPES[imgExt] || 'image/png';

      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: imgMediaType,
          data,
        },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last image
  if (lastIndex < input.length) {
    const textAfter = input.slice(lastIndex).trim();
    if (textAfter) {
      hasText = true;
      blocks.push({ type: 'text', text: textAfter });
    }
  }

  // If no images found and no text, return original input as text
  if (blocks.length === 0 || hasText === false && blocks.length === 0) {
    return [{ type: 'text', text: input }];
  }

  // If only text (no images found), return as text
  if (blocks.every(b => b.type === 'text')) {
    return [{ type: 'text', text: input }];
  }

  return blocks;
}
