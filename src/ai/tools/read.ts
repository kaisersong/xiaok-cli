import { readFileSync, existsSync, openSync, readSync, closeSync, fstatSync, realpathSync } from 'fs';
import { extname, resolve } from 'path';
import type { Tool } from '../../types.js';
import { assertWorkspacePath, type OutsideWorkspaceGuard } from '../permissions/workspace.js';
import { truncateText } from './truncation.js';
import { extractMaterialText } from '../../runtime/materials/text-extractor.js';
import { detectImageMediaType } from '../../shared/media/image.js';
import { validateToolImage } from '../runtime/tool-image-channel.js';
import {
  MODEL_OUTPUT_CAP,
  SENSITIVE_FILE_REDACTION,
  isSensitiveFilePath,
  redactSecrets,
} from '../../shared/stream-safety/redact.js';

export interface WorkspaceToolOptions {
  cwd?: string;
  allowOutsideCwd?: boolean;
  /** allowOutsideCwd 时对工作区外（含符号链接指向区外）路径的二次检查，通常是沙箱策略。 */
  outsideCwdGuard?: OutsideWorkspaceGuard;
  artifactRoot?: string;
  /** Host-owned exact read-only references; never accepted from model input. */
  readOnlyPaths?: string[];
}

const OOXML_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const HEADER_SNIFF_BYTES = 4096;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function readBoundedImage(path: string): Buffer {
  const handle = openSync(path, 'r');
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('图片只能是最多 4MiB 的普通文件');
    // Use the same fd and a fixed ceiling so concurrent file growth cannot
    // turn a size check followed by readFile into an unbounded allocation.
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_IMAGE_BYTES + 1));
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(handle, buffer, size, buffer.length - size, size);
      if (!read) break;
      size += read;
    }
    if (size > stat.size || size > MAX_IMAGE_BYTES) throw new Error('图片读取期间发生变化或超过 4MiB，请重试');
    return buffer.subarray(0, size);
  } finally { closeSync(handle); }
}

/**
 * Extraction ceiling for Office documents. Deliberately far above the
 * extractor's own 50K default so that a line `offset` past that default still
 * lands on real content; still bounded so a pathological file cannot make the
 * tool do unbounded work.
 */
const OFFICE_EXTRACTION_CAP = 2_000_000;

type ReadContentKind = 'text' | 'ooxml' | 'pdf' | 'binary';

function readHeader(path: string): Buffer {
  const handle = openSync(path, 'r');
  try {
    const header = Buffer.alloc(HEADER_SNIFF_BYTES);
    const bytesRead = readSync(handle, header, 0, HEADER_SNIFF_BYTES, 0);
    return header.subarray(0, bytesRead);
  } finally {
    closeSync(handle);
  }
}

function classifyReadContent(path: string, header: Buffer): ReadContentKind {
  // Office extensions go to the extractor even when the bytes are not a ZIP:
  // it recognises a legacy .xls renamed to .xlsx and says so.
  if (OOXML_EXTENSIONS.has(extname(path).toLowerCase())) return 'ooxml';
  if (header.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (header.includes(0)) return 'binary';
  return 'text';
}

export function createReadTool(options: WorkspaceToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const allowOutsideCwd = options.allowOutsideCwd ?? false;
  const readOnlyPaths = new Set((options.readOnlyPaths ?? []).flatMap(file => {try {return [realpathSync(file)];}catch{return [];}}));

  return {
    permission: 'safe',
    definition: {
      name: 'read',
      description: '读取文件内容，文本带行号，Office 文档（docx/pptx/xlsx）自动提取文本。PNG/JPEG/GIF/WebP 图片作为视觉输入返回（需支持图片的模型，最多 4MiB）；图片不使用 offset/limit/max_chars。只能读取获准路径，严禁根据压缩文件大小推断图片内容。',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件绝对路径' },
          offset: { type: 'number', description: '起始行号（1-based，可选）' },
          limit: { type: 'number', description: '最多读取行数（可选）' },
          max_chars: { type: 'number', description: '输出字符上限（默认 256KB）' },
        },
        required: ['file_path'],
      },
    },
    async execute(input, context) {
      context?.signal?.throwIfAborted();
      const { file_path, offset = 1, limit, max_chars = MODEL_OUTPUT_CAP } = input as {
        file_path: string;
        offset?: number;
        limit?: number;
        max_chars?: number;
      };
      let resolvedPath: string;
      try { resolvedPath = assertWorkspacePath(file_path, cwd, 'read', allowOutsideCwd, options.outsideCwdGuard); }
      catch (error) {
        let reference: string | undefined;
        try { reference = realpathSync(resolve(file_path)); } catch { /* Preserve the original denial. */ }
        if (!reference || !readOnlyPaths.has(reference)) throw error;
        resolvedPath = reference;
      }
      if (!existsSync(resolvedPath)) return `Error: 文件不存在: ${resolvedPath}`;
      if (isSensitiveFilePath(resolvedPath)) {
        return SENSITIVE_FILE_REDACTION;
      }
      try {
        const header = readHeader(resolvedPath);
        const kind = classifyReadContent(resolvedPath, header);
        const mediaType = detectImageMediaType(header);
        if (mediaType && kind !== 'ooxml' && kind !== 'pdf') {
          if (context?.modelSupportsImageInput !== true || !context.emitToolImage) {
            return 'Error: 当前调用没有可用的视觉图片输入通道。请切换到支持图片输入的模型；不能根据文件大小推断画面内容。';
          }
          const data = readBoundedImage(resolvedPath);
          const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: data.toString('base64') } };
          const dimensions = validateToolImage(image);
          context.signal?.throwIfAborted();
          context.emitToolImage(image);
          return `图片已作为视觉输入返回（${mediaType}，${dimensions.width}×${dimensions.height}）。请依据图像内容分析，而非文件大小。`;
        }
        if (kind === 'pdf') {
          return 'Error: 无法以文本方式读取 PDF。请把它作为附件交给 Desktop 的 read_material，或先转换为文本。';
        }
        if (kind === 'binary') {
          return `Error: 这是二进制文件，无法以文本方式读取: ${resolvedPath}`;
        }

        let content: string;
        if (kind === 'ooxml') {
          const extraction = await extractMaterialText({
            workspacePath: resolvedPath,
            mimeType: '',
            maxChars: OFFICE_EXTRACTION_CAP,
          });
          if (extraction.parseStatus !== 'parsed' || !extraction.text) {
            return `Error: ${extraction.errorMessage ?? '未能从该 Office 文档提取到可读正文'}`;
          }
          content = extraction.text;
        } else {
          content = readFileSync(resolvedPath, 'utf-8');
        }

        const lines = content.split('\n');
        context?.signal?.throwIfAborted();
        const start = offset - 1;
        const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
        const numbered = slice.map((line, index) => `${start + index + 1}\t${line}`).join('\n');
        return truncateText(redactSecrets(numbered).text, max_chars).text;
      } catch (e) {
        context?.signal?.throwIfAborted();
        return `Error: ${String(e)}`;
      }
    },
  };
}

export const readTool = createReadTool();
