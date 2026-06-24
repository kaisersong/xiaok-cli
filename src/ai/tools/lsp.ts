import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tool } from '../../types.js';
import { runFallbackGrepSearch } from './grep.js';

interface LspClient {
  didOpenDocument(document: { uri: string; languageId: string; version?: number; text: string }): Promise<void>;
  goToDefinition(uri: string, line: number, character: number): Promise<unknown>;
  findReferences(uri: string, line: number, character: number): Promise<unknown>;
  hover(uri: string, line: number, character: number): Promise<unknown>;
  documentSymbols(uri: string): Promise<unknown>;
}

export interface LspToolOptions {
  getLspClient(): LspClient | undefined;
  cwd?: string;
}

interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function formatLocation(loc: LspLocation, cwd?: string): string {
  const uri = loc.uri.startsWith('file://') ? loc.uri.slice('file://'.length) : loc.uri;
  const path = cwd && uri.startsWith(cwd) ? uri.slice(cwd.length + 1) : uri;
  const { line, character } = loc.range.start;
  return `${path}:${line + 1}:${character + 1}`;
}

function fileToUri(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

function ensureAbsolute(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

// 声明语句的多语言近似正则：捕获 (关键字, 符号名)。
// 注意：这是语法近似（非语义真相），仅用于未配置 LSP server 时的 documentSymbol 降级。
const DECLARATION_REGEX =
  '^\\s*(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:public\\s+|private\\s+|protected\\s+)?(?:pub(?:\\s*\\([^)]*\\))?\\s+)?(?:abstract\\s+)?(?:async\\s+)?(class|interface|enum|struct|trait|impl|type|function|func|def|fn)\\s+([A-Za-z_$][\\w$]*)';

const KEYWORD_KIND: Record<string, string> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  struct: 'struct',
  trait: 'interface',
  impl: 'class',
  type: 'type',
  function: 'function',
  func: 'function',
  def: 'function',
  fn: 'function',
};

/**
 * 未配置 LSP server 时的 documentSymbol 降级。
 * 复用 grep.ts 的纯 JS 正则回退 runFallbackGrepSearch，
 * 不依赖 rg/grep 二进制，保证 Windows / 精简环境也能工作（AGENTS.md 跨平台硬规则）。
 */
async function fallbackDocumentSymbols(absPath: string): Promise<string> {
  let matches: string[];
  try {
    matches = await runFallbackGrepSearch({
      pattern: DECLARATION_REGEX,
      path: absPath,
      output_mode: 'lines',
    });
  } catch {
    return '无符号信息（regex 降级失败，未配置 LSP server）';
  }

  const prefix = `${absPath}:`;
  const re = new RegExp(DECLARATION_REGEX);
  const entries: string[] = [];
  for (const entry of matches) {
    // runFallbackGrepSearch 返回 `${absPath}:${line}:${content}`；
    // 按已知 absPath 长度切割，避免 Windows 盘符冒号（C:\）误判。
    if (!entry.startsWith(prefix)) continue;
    const rest = entry.slice(prefix.length);
    const sep = rest.indexOf(':');
    if (sep < 0) continue;
    const lineNo = rest.slice(0, sep);
    const content = rest.slice(sep + 1);
    const m = re.exec(content);
    if (!m) continue;
    const kind = KEYWORD_KIND[m[1]] ?? m[1];
    entries.push(`${m[2]} [${kind}] line ${lineNo}`);
  }

  if (entries.length === 0) {
    return '无符号信息（regex 降级，未配置 LSP server）';
  }
  return `（regex 降级：未配置 LSP server；语法近似，非语义真相，精确语义请配置 LSP）\n${entries.join('\n')}`;
}

export function createLspTool(options: LspToolOptions): Tool {
  const cwd = options.cwd ?? process.cwd();

  return {
    permission: 'safe',
    definition: {
      name: 'lsp',
      description: '代码智能工具：跳转定义、查找引用、悬停文档、文档符号列表。goToDefinition/findReferences/hover 需要项目配置 LSP 服务器；documentSymbol 在未配置 LSP 时自动用语法正则降级（近似，非语义真相）。',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol'],
            description: '操作类型',
          },
          file_path: {
            type: 'string',
            description: '文件路径（绝对路径或相对于 cwd 的路径）',
          },
          line: {
            type: 'number',
            description: '行号（1-based）',
          },
          character: {
            type: 'number',
            description: '列号（1-based）',
          },
        },
        required: ['operation', 'file_path'],
      },
    },
    async execute(input) {
      const { operation, file_path, line = 1, character = 1 } = input as {
        operation: string;
        file_path: string;
        line?: number;
        character?: number;
      };

      const absPath = ensureAbsolute(file_path, cwd);
      if (!existsSync(absPath)) {
        return `Error: 文件不存在: ${absPath}`;
      }

      const client = options.getLspClient();
      if (!client) {
        // 未配置 LSP server 时，documentSymbol 用纯 JS 正则降级，而非直接报错。
        if (operation === 'documentSymbol') {
          return await fallbackDocumentSymbols(absPath);
        }
        return 'Error: 没有可用的 LSP 服务器。请在 .xiaok/settings.json 中配置 lspServers。（documentSymbol 操作支持无 server 正则降级，其余操作需要 LSP）';
      }

      const uri = fileToUri(absPath);
      // LSP 行列号是 0-based
      const lspLine = line - 1;
      const lspChar = character - 1;

      try {
        // 确保文件已打开
        const text = readFileSync(absPath, 'utf-8');
        const ext = absPath.split('.').pop() ?? '';
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'typescriptreact',
          js: 'javascript', jsx: 'javascriptreact',
          py: 'python', go: 'go', rs: 'rust',
          java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c',
        };
        await client.didOpenDocument({
          uri,
          languageId: langMap[ext] ?? ext,
          text,
        });

        switch (operation) {
          case 'goToDefinition': {
            const result = await client.goToDefinition(uri, lspLine, lspChar) as LspLocation | LspLocation[] | null;
            if (!result) return '未找到定义';
            const locations = Array.isArray(result) ? result : [result];
            return locations.map((loc) => formatLocation(loc, cwd)).join('\n');
          }

          case 'findReferences': {
            const result = await client.findReferences(uri, lspLine, lspChar) as LspLocation[] | null;
            if (!result || result.length === 0) return '未找到引用';
            return `找到 ${result.length} 个引用:\n${result.map((loc) => formatLocation(loc, cwd)).join('\n')}`;
          }

          case 'hover': {
            const result = await client.hover(uri, lspLine, lspChar) as { contents: unknown } | null;
            if (!result) return '无悬停信息';
            const contents = result.contents;
            if (typeof contents === 'string') return contents;
            if (Array.isArray(contents)) return contents.map((c) => (typeof c === 'string' ? c : c.value ?? '')).join('\n');
            if (typeof contents === 'object' && contents !== null && 'value' in contents) return String((contents as { value: unknown }).value);
            return JSON.stringify(contents);
          }

          case 'documentSymbol': {
            const result = await client.documentSymbols(uri) as Array<{ name: string; kind: number; range: LspLocation['range'] }> | null;
            if (!result || result.length === 0) return '无符号信息';
            const kindNames: Record<number, string> = {
              1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class',
              6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum',
              11: 'interface', 12: 'function', 13: 'variable', 14: 'constant',
            };
            return result.map((sym) => {
              const kind = kindNames[sym.kind] ?? `kind(${sym.kind})`;
              const { line: l } = sym.range.start;
              return `${sym.name} [${kind}] line ${l + 1}`;
            }).join('\n');
          }

          default:
            return `Error: 未知操作: ${operation}`;
        }
      } catch (e) {
        return `Error: LSP 请求失败: ${String(e)}`;
      }
    },
  };
}
