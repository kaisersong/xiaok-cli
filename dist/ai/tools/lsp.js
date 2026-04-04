import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
function formatLocation(loc, cwd) {
    const uri = loc.uri.startsWith('file://') ? loc.uri.slice('file://'.length) : loc.uri;
    const path = cwd && uri.startsWith(cwd) ? uri.slice(cwd.length + 1) : uri;
    const { line, character } = loc.range.start;
    return `${path}:${line + 1}:${character + 1}`;
}
function fileToUri(filePath) {
    return pathToFileURL(filePath).toString();
}
function ensureAbsolute(filePath, cwd) {
    if (filePath.startsWith('/'))
        return filePath;
    return `${cwd}/${filePath}`;
}
export function createLspTool(options) {
    const cwd = options.cwd ?? process.cwd();
    return {
        permission: 'safe',
        definition: {
            name: 'lsp',
            description: '代码智能工具：跳转定义、查找引用、悬停文档、文档符号列表。需要项目配置 LSP 服务器。',
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
            const { operation, file_path, line = 1, character = 1 } = input;
            const client = options.getLspClient();
            if (!client) {
                return 'Error: 没有可用的 LSP 服务器。请在 .xiaok/settings.json 中配置 lspServers。';
            }
            const absPath = ensureAbsolute(file_path, cwd);
            if (!existsSync(absPath)) {
                return `Error: 文件不存在: ${absPath}`;
            }
            const uri = fileToUri(absPath);
            // LSP 行列号是 0-based
            const lspLine = line - 1;
            const lspChar = character - 1;
            try {
                // 确保文件已打开
                const text = readFileSync(absPath, 'utf-8');
                const ext = absPath.split('.').pop() ?? '';
                const langMap = {
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
                        const result = await client.goToDefinition(uri, lspLine, lspChar);
                        if (!result)
                            return '未找到定义';
                        const locations = Array.isArray(result) ? result : [result];
                        return locations.map((loc) => formatLocation(loc, cwd)).join('\n');
                    }
                    case 'findReferences': {
                        const result = await client.findReferences(uri, lspLine, lspChar);
                        if (!result || result.length === 0)
                            return '未找到引用';
                        return `找到 ${result.length} 个引用:\n${result.map((loc) => formatLocation(loc, cwd)).join('\n')}`;
                    }
                    case 'hover': {
                        const result = await client.hover(uri, lspLine, lspChar);
                        if (!result)
                            return '无悬停信息';
                        const contents = result.contents;
                        if (typeof contents === 'string')
                            return contents;
                        if (Array.isArray(contents))
                            return contents.map((c) => (typeof c === 'string' ? c : c.value ?? '')).join('\n');
                        if (typeof contents === 'object' && contents !== null && 'value' in contents)
                            return String(contents.value);
                        return JSON.stringify(contents);
                    }
                    case 'documentSymbol': {
                        const result = await client.documentSymbols(uri);
                        if (!result || result.length === 0)
                            return '无符号信息';
                        const kindNames = {
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
            }
            catch (e) {
                return `Error: LSP 请求失败: ${String(e)}`;
            }
        },
    };
}
