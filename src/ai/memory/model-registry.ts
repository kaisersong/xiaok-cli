import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import { getConfigDir } from '../../utils/config.js';

interface DownloadableFile {
  filename: string;
  url: string;
  mirror?: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  dims: number;
  size: string;
  languages: string;
  downloadFiles: DownloadableFile[];
  requiredFiles: string[];
}

const HF = 'https://huggingface.co';
const MIRROR = 'https://hf-mirror.com';

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    id: 'all-MiniLM-L6-v2',
    name: 'MiniLM',
    dims: 384,
    size: '~90MB',
    languages: '英文为主，中英混合可用',
    requiredFiles: ['model.onnx', 'tokenizer.json'],
    downloadFiles: [
      {
        filename: 'model.onnx',
        url: `${HF}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx`,
        mirror: `${MIRROR}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx`,
      },
      {
        filename: 'tokenizer.json',
        url: `${HF}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json`,
        mirror: `${MIRROR}/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json`,
      },
    ],
  },
  {
    id: 'bge-small-zh-v1.5',
    name: 'BGE 中文',
    dims: 512,
    size: '~95MB',
    languages: '中文优化，英文也可用',
    requiredFiles: ['model.onnx', 'model.onnx_data', 'tokenizer.json'],
    downloadFiles: [
      {
        filename: 'model.onnx',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx`,
      },
      {
        filename: 'model.onnx_data',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx_data`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/onnx/model.onnx_data`,
      },
      {
        filename: 'tokenizer.json',
        url: `${HF}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/tokenizer.json`,
        mirror: `${MIRROR}/onnx-community/bge-small-zh-v1.5-ONNX/resolve/main/tokenizer.json`,
      },
    ],
  },
];

export function getModelDir(modelId?: string): string {
  const id = modelId || 'all-MiniLM-L6-v2';
  return path.join(getConfigDir(), 'embedding', id);
}

export function isModelDownloaded(modelId?: string): boolean {
  const entry = MODEL_REGISTRY.find(m => m.id === (modelId || 'all-MiniLM-L6-v2'));
  if (!entry) return false;
  const dir = getModelDir(modelId);
  return entry.requiredFiles.every(f => fs.existsSync(path.join(dir, f)));
}

export function findModel(modelId: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId);
}

export function getManualDownloadHint(modelId: string): { urls: { file: string; url: string }[]; targetDir: string } {
  const entry = findModel(modelId);
  const dir = getModelDir(modelId);
  return {
    urls: entry?.downloadFiles.map(f => ({ file: f.filename, url: f.url })) ?? [],
    targetDir: dir,
  };
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    const file = createWriteStream(dest);
    const request = (href: string) => {
      get(href, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          const next = location.startsWith('/') ? new URL(location, href).href : location;
          res.resume();
          request(next);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => { file.close(); if (fs.existsSync(dest)) fs.unlinkSync(dest); reject(err); });
    };
    request(url);
  });
}

export async function downloadModel(modelId: string): Promise<void> {
  const entry = findModel(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}. Available: ${MODEL_REGISTRY.map(m => m.id).join(', ')}`);

  const dir = getModelDir(modelId);
  fs.mkdirSync(dir, { recursive: true });

  for (const df of entry.downloadFiles) {
    const dest = path.join(dir, df.filename);
    if (fs.existsSync(dest)) continue;

    try {
      await downloadFile(df.url, dest);
    } catch {
      if (df.mirror) {
        try {
          await downloadFile(df.mirror, dest);
        } catch {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          throw new Error(
            `下载 ${df.filename} 失败。\n` +
            `请手动下载后放入以下目录：\n  ${dir}\n\n` +
            `下载地址：\n  ${df.url}\n` +
            `备用：${df.mirror}\n`
          );
        }
      } else {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        throw new Error(
          `下载 ${df.filename} 失败。\n` +
          `请手动下载后放入以下目录：\n  ${dir}\n\n` +
          `下载地址：\n  ${df.url}\n`
        );
      }
    }
  }
}
