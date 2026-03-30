import { spawnSync } from 'child_process';
import type { Tool } from '../../types.js';
import { appendPaginationNotice, paginateItems, truncateText } from './truncation.js';

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

    // 优先使用 rg（ripgrep），回退到 grep
    const hasRg = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
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
      : [
        '-rn',
        ...(context > 0 ? ['-C', String(context)] : []),
        ...(output_mode === 'files' ? ['-l'] : []),
        ...(output_mode === 'count' ? ['-c'] : []),
        pattern,
        ...(fileGlob ? ['--include', fileGlob] : []),
        searchPath,
      ];

    const result = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const output = (result.stdout ?? '').trim();
    if (!output) return '（无匹配结果）';
    const page = paginateItems(output.split(/\r?\n/), offset, head_limit);
    return appendPaginationNotice(truncateText(page.items.join('\n'), max_chars).text, page.nextOffset);
  },
};
