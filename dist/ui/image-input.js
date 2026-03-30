import { existsSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';
const IMAGE_MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};
function normalizeInputPath(input) {
    return input.trim().replace(/^['"]|['"]$/g, '');
}
export async function parseInputBlocks(input, supportsImages) {
    const normalized = normalizeInputPath(input);
    const extension = extname(normalized).toLowerCase();
    const mediaType = IMAGE_MIME_TYPES[extension];
    if (!mediaType || !existsSync(normalized)) {
        return [{ type: 'text', text: input }];
    }
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
