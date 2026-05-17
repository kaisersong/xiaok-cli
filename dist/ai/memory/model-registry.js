import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import { getConfigDir } from '../../utils/config.js';
export const MODEL_REGISTRY = [
    {
        id: 'all-MiniLM-L6-v2',
        name: 'MiniLM',
        dims: 384,
        size: '~22MB',
        languages: '英文为主，中英混合可用',
        files: {
            model: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/model.onnx',
            tokenizer: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
        },
        mirrorFiles: {
            model: 'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/model.onnx',
            tokenizer: 'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
        },
    },
    {
        id: 'bge-small-zh-v1.5',
        name: 'BGE 中文',
        dims: 512,
        size: '~90MB',
        languages: '中文优化，英文也可用',
        files: {
            model: 'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/model.onnx',
            tokenizer: 'https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/tokenizer.json',
        },
        mirrorFiles: {
            model: 'https://hf-mirror.com/BAAI/bge-small-zh-v1.5/resolve/main/model.onnx',
            tokenizer: 'https://hf-mirror.com/BAAI/bge-small-zh-v1.5/resolve/main/tokenizer.json',
        },
    },
];
export function getModelDir(modelId) {
    const id = modelId || 'all-MiniLM-L6-v2';
    return path.join(getConfigDir(), 'embedding', id);
}
export function isModelDownloaded(modelId) {
    const dir = getModelDir(modelId);
    return fs.existsSync(path.join(dir, 'model.onnx')) && fs.existsSync(path.join(dir, 'tokenizer.json'));
}
export function findModel(modelId) {
    return MODEL_REGISTRY.find(m => m.id === modelId);
}
export function getManualDownloadHint(modelId) {
    const entry = findModel(modelId);
    const dir = getModelDir(modelId);
    return {
        urls: [
            { file: 'model.onnx', url: entry?.files.model ?? '' },
            { file: 'tokenizer.json', url: entry?.files.tokenizer ?? '' },
        ],
        targetDir: dir,
    };
}
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(dest, { flags: 'wx' });
        const request = (href) => {
            get(href, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    request(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        };
        request(url);
    });
}
export async function downloadModel(modelId) {
    const entry = findModel(modelId);
    if (!entry)
        throw new Error(`Unknown model: ${modelId}. Available: ${MODEL_REGISTRY.map(m => m.id).join(', ')}`);
    const dir = getModelDir(modelId);
    fs.mkdirSync(dir, { recursive: true });
    const modelPath = path.join(dir, 'model.onnx');
    const tokenizerPath = path.join(dir, 'tokenizer.json');
    const filesToDownload = [];
    if (!fs.existsSync(modelPath))
        filesToDownload.push({ key: 'model', filename: 'model.onnx' });
    if (!fs.existsSync(tokenizerPath))
        filesToDownload.push({ key: 'tokenizer', filename: 'tokenizer.json' });
    for (const { key, filename } of filesToDownload) {
        const dest = path.join(dir, filename);
        try {
            await downloadFile(entry.files[key], dest);
        }
        catch {
            try {
                const mirrorUrl = entry.mirrorFiles?.[key];
                if (!mirrorUrl)
                    throw new Error('no mirror');
                await downloadFile(mirrorUrl, dest);
            }
            catch {
                if (fs.existsSync(dest))
                    fs.unlinkSync(dest);
                throw new Error(`下载 ${filename} 失败。\n` +
                    `请手动下载后放入以下目录：\n  ${dir}\n\n` +
                    `下载地址：\n` +
                    `  ${entry.files[key]}\n` +
                    (entry.mirrorFiles?.[key] ? `  备用：${entry.mirrorFiles[key]}\n` : ''));
            }
        }
    }
}
