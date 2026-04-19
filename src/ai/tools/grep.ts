import { spawnSync } from 'child_process';
import fg from 'fast-glob';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import type { Tool } from '../../types.js';
import { appendPaginationNotice, paginateItems, truncateText } from './truncation.js';

const TYPE_GLOBS: Record<string, string[]> = {
  ts: ['**/*.ts', '**/*.tsx'],
  js: ['**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
  json: ['**/*.json'],
  md: ['**/*.md'],
  py: ['**/*.py'],
  css: ['**/*.css'],
  html: ['**/*.html', '**/*.htm'],
  yaml: ['**/*.yaml', '**/*.yml'],
  yml: ['**/*.yml', '**/*.yaml'],
};

function canRunCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0 && !result.error;
}

function buildRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`无效正则: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveFallbackFiles(searchPath: string, fileGlob?: string, type?: string): Promise<string[]> {
  const resolvedPath = resolve(searchPath);
  const stats = statSync(resolvedPath);
  if (stats.isFile()) {
    return [resolvedPath];
  }

  const patterns = fileGlob
    ? [fileGlob]
    : type
      ? (TYPE_GLOBS[type] ?? [`**/*.${type}`])
      : ['**/*'];

  return fg(patterns, {
    cwd: resolvedPath,
    absolute: true,
    onlyFiles: true,
    dot: true,
    unique: true,
    suppressErrors: true,
    ignore: ['**/.git/**', '**/node_modules/**'],
  });
}

export async function runFallbackGrepSearch(input: {
  pattern: string;
  path?: string;
  glob?: string;
  context?: number;
  output_mode?: string;
  type?: string;
}): Promise<string[]> {
  const {
    pattern,
    path: searchPath = process.cwd(),
    glob: fileGlob,
    context = 0,
    output_mode = 'lines',
    type,
  } = input;
  const matcher = buildRegex(pattern);
  const files = await resolveFallbackFiles(searchPath, fileGlob, type);
  const results: string[] = [];

  for (const file of files) {
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    } catch {
      continue;
    }

    const matchedIndexes = lines
      .map((line, index) => (matcher.test(line) ? index : -1))
      .filter((index) => index >= 0);

    if (matchedIndexes.length === 0) {
      continue;
    }

    if (output_mode === 'files') {
      results.push(file);
      continue;
    }

    if (output_mode === 'count') {
      results.push(`${file}:${matchedIndexes.length}`);
      continue;
    }

    const includedIndexes = new Set<number>();
    for (const matchIndex of matchedIndexes) {
      const start = Math.max(0, matchIndex - context);
      const end = Math.min(lines.length - 1, matchIndex + context);
      for (let index = start; index <= end; index += 1) {
        includedIndexes.add(index);
      }
    }

    const orderedIndexes = [...includedIndexes].sort((a, b) => a - b);
    for (const lineIndex of orderedIndexes) {
      results.push(`${file}:${lineIndex + 1}:${lines[lineIndex]}`);
    }
  }

  return results;
}

export const grepTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'grep',
    description: '在文件中搜索正则表达式，返回匹配行（含文件名和行号）',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        path: { type: 'string', description: '搜索目录或文件（可选，默认当前目录）' },
        glob: { type: 'string', description: '文件过滤 glob（可选，如 *.ts）' },
        context: { type: 'number', description: '匹配前后文行数（默认 0）' },
        head_limit: { type: 'number', description: '单次返回条数（默认 50）' },
        offset: { type: 'number', description: '分页偏移量（默认 0）' },
        output_mode: { type: 'string', description: '输出模式（lines/files/count）' },
        type: { type: 'string', description: '文件类型过滤（如 ts, md）' },
        max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const {
      pattern,
      path: searchPath = process.cwd(),
      glob: fileGlob,
      context = 0,
      head_limit = 50,
      offset = 0,
      output_mode = 'lines',
      type,
      max_chars = 12_000,
    } = input as {
      pattern: string;
      path?: string;
      glob?: string;
      context?: number;
      head_limit?: number;
      offset?: number;
      output_mode?: string;
      type?: string;
      max_chars?: number;
    };

    // 优先使用 rg（ripgrep），回退到 grep，再回退到纯 Node 搜索。
    const hasRg = canRunCommand('rg');
    const hasGrep = !hasRg && canRunCommand('grep');
    const cmd = hasRg ? 'rg' : 'grep';
    const args = hasRg
      ? [
        '-n',
        '--color=never',
        ...(context > 0 ? ['-C', String(context)] : []),
        ...(output_mode === 'files' ? ['-l'] : []),
        ...(output_mode === 'count' ? ['-c'] : []),
        ...(type ? ['-t', type] : []),
        ...(fileGlob ? ['-g', fileGlob] : []),
        pattern,
        searchPath,
      ]
      : hasGrep
        ? [
        '-rn',
        ...(context > 0 ? ['-C', String(context)] : []),
        ...(output_mode === 'files' ? ['-l'] : []),
        ...(output_mode === 'count' ? ['-c'] : []),
        pattern,
        ...(fileGlob ? ['--include', fileGlob] : []),
        searchPath,
      ]
        : [];

    const output = hasRg || hasGrep
      ? (spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).stdout ?? '').trim()
      : (await runFallbackGrepSearch({
        pattern,
        path: searchPath,
        glob: fileGlob,
        context,
        output_mode,
        type,
      })).join('\n').trim();
    if (!output) return '（无匹配结果）';
    const page = paginateItems(output.split(/\r?\n/), offset, head_limit);
    return appendPaginationNotice(truncateText(page.items.join('\n'), max_chars).text, page.nextOffset);
  },
};
