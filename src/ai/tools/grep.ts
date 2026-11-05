import {isNativeReadonlyExecutionContext} from './native-readonly-context.js';
import { spawnSync } from 'child_process';
import { runBoundedGrep, formatSearchPath, type GrepTruncation } from './bounded-glob.js';
import {getSandboxSearchGuard,type SearchPathGuard} from '../../platform/sandbox/search-scope.js';
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

export async function runFallbackGrepSearch(input: {
  pattern: string;
  path?: string;
  glob?: string;
  context?: number;
  output_mode?: string;
  type?: string;
  signal?: AbortSignal;
  guard?:SearchPathGuard;
}): Promise<string[] & {truncated?: GrepTruncation[]}> {
  const {
    pattern,
    path: searchPath = process.cwd(),
    glob: fileGlob,
    context = 0,
    output_mode = 'lines',
    type,
  } = input;
  const patterns=fileGlob?[fileGlob]:type?(TYPE_GLOBS[type]??[`**/*.${type}`]):['**/*'];
  const entries=await runBoundedGrep({cwd:resolve(searchPath),patterns,dot:true,skipInaccessible:true,
    ignore:['**/.git/**','**/node_modules/**'],grep:{pattern,context,outputMode:output_mode}},input.signal,input.guard);
  const lines=entries.map(entry=>{
    const file=formatSearchPath(entry.path);
    return output_mode==='files'?file:output_mode==='count'?`${file}:${entry.count}`:`${file}:${entry.lineNo}:${entry.text}`;
  });
  return Object.assign(lines,{truncated:entries.truncated??[]});
}

const TRUNCATION_NOTICE: Record<GrepTruncation,string>={
  result_limit:'匹配结果超过上限，只返回了前面的部分',
  file_too_large:'跳过了超过 8MB 的文件',
  read_budget:'累计读取超过 16MB，后面的文件没有搜索',
};
/** Visible note so a cut-short search is never mistaken for a complete one. */
export function grepTruncationNotice(truncated: readonly GrepTruncation[]|undefined):string{
  return truncated?.length?`\n（搜索已截断：${truncated.map(reason=>TRUNCATION_NOTICE[reason]).join('；')}）`:'';
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
  async execute(input, toolContext) {
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

    const guard=getSandboxSearchGuard(toolContext);
    if(guard){
      try{
        // Never probe external programs or hand them a recursively searched root
        // when the host has installed a per-invocation sandbox policy.
        const lines=await runFallbackGrepSearch({pattern,path:searchPath,glob:fileGlob,context,output_mode,type,signal:toolContext?.signal,guard});
        const notice=grepTruncationNotice(lines.truncated);
        if(!lines.length)return `（无匹配结果）${notice}`;
        const page=paginateItems(lines,offset,head_limit);
        return appendPaginationNotice(truncateText(page.items.join('\n'),max_chars).text,page.nextOffset)+notice;
      }catch(error){
        toolContext?.signal?.throwIfAborted();
        const code=error instanceof Error?error.message:'';
        return `Error: ${/^(?:glob_[a-z_]+|grep_[a-z_]+|native_readonly_sandbox_changed)$/.test(code)||code==='sandbox denied search path'?code:'grep_search_failed'}`;
      }
    }
    // 非 sandbox 调用保留 rg → grep → worker Node fallback。
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
        ...(isNativeReadonlyExecutionContext(toolContext) ? ['--no-config', '--no-pre'] : []),
        '-e', pattern,
        '--', searchPath,
      ]
      : hasGrep
        ? [
        '-rn',
        ...(context > 0 ? ['-C', String(context)] : []),
        ...(output_mode === 'files' ? ['-l'] : []),
        ...(output_mode === 'count' ? ['-c'] : []),
        ...(fileGlob ? ['--include', fileGlob] : []),
        '-e', pattern,
        '--', searchPath,
      ]
        : [];

    let notice = '';
    const output = hasRg || hasGrep
      ? (spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).stdout ?? '').trim()
      : await (async () => {
        const lines = await runFallbackGrepSearch({
          pattern,
          path: searchPath,
          glob: fileGlob,
          context,
          output_mode,
          type,
          signal: toolContext?.signal,
        });
        notice = grepTruncationNotice(lines.truncated);
        return lines.join('\n').trim();
      })();
    if (!output) return `（无匹配结果）${notice}`;
    const page = paginateItems(output.split(/\r?\n/), offset, head_limit);
    return appendPaginationNotice(truncateText(page.items.join('\n'), max_chars).text, page.nextOffset) + notice;
  },
};
