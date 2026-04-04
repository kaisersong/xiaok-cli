import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLspTool } from '../../../src/ai/tools/lsp.js';
import type { LspToolOptions } from '../../../src/ai/tools/lsp.js';

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    didOpenDocument: vi.fn(async () => undefined),
    goToDefinition: vi.fn(async () => null),
    findReferences: vi.fn(async () => null),
    hover: vi.fn(async () => null),
    documentSymbols: vi.fn(async () => null),
    ...overrides,
  };
}

describe('createLspTool', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-lsp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sample.ts'), 'export function hello() {}');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns error when no LSP client is available', async () => {
    const tool = createLspTool({ getLspClient: () => undefined, cwd: dir });
    const result = await tool.execute({ operation: 'hover', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toContain('Error');
    expect(result).toContain('LSP');
  });

  it('returns error when file does not exist', async () => {
    const client = makeMockClient();
    const tool = createLspTool({ getLspClient: () => client as LspToolOptions['getLspClient'] extends () => infer R ? Exclude<R, undefined> : never, cwd: dir });
    const result = await tool.execute({ operation: 'hover', file_path: 'nonexistent.ts', line: 1, character: 1 });
    expect(result).toContain('Error');
  });

  it('returns "无悬停信息" when hover returns null', async () => {
    const client = makeMockClient({ hover: vi.fn(async () => null) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'hover', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('无悬停信息');
  });

  it('returns hover text when hover returns string contents', async () => {
    const client = makeMockClient({ hover: vi.fn(async () => ({ contents: 'function hello(): void' })) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'hover', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('function hello(): void');
  });

  it('returns hover text when hover returns MarkupContent', async () => {
    const client = makeMockClient({ hover: vi.fn(async () => ({ contents: { kind: 'markdown', value: '**hello**' } })) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'hover', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('**hello**');
  });

  it('returns "未找到定义" when goToDefinition returns null', async () => {
    const client = makeMockClient({ goToDefinition: vi.fn(async () => null) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'goToDefinition', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('未找到定义');
  });

  it('formats definition location relative to cwd', async () => {
    const absPath = join(dir, 'other.ts');
    writeFileSync(absPath, '');
    const client = makeMockClient({
      goToDefinition: vi.fn(async () => ({
        uri: `file://${absPath}`,
        range: { start: { line: 4, character: 9 }, end: { line: 4, character: 14 } },
      })),
    });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'goToDefinition', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('other.ts:5:10');
  });

  it('returns "未找到引用" when findReferences returns empty', async () => {
    const client = makeMockClient({ findReferences: vi.fn(async () => []) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'findReferences', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toBe('未找到引用');
  });

  it('returns reference count and locations', async () => {
    const absPath = join(dir, 'sample.ts');
    const client = makeMockClient({
      findReferences: vi.fn(async () => [
        { uri: `file://${absPath}`, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
        { uri: `file://${absPath}`, range: { start: { line: 2, character: 3 }, end: { line: 2, character: 8 } } },
      ]),
    });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'findReferences', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toContain('2 个引用');
    expect(result).toContain('sample.ts:1:1');
    expect(result).toContain('sample.ts:3:4');
  });

  it('returns "无符号信息" when documentSymbol returns empty', async () => {
    const client = makeMockClient({ documentSymbols: vi.fn(async () => []) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'documentSymbol', file_path: 'sample.ts' });
    expect(result).toBe('无符号信息');
  });

  it('formats document symbols with kind and line', async () => {
    const client = makeMockClient({
      documentSymbols: vi.fn(async () => [
        { name: 'hello', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 25 } } },
      ]),
    });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'documentSymbol', file_path: 'sample.ts' });
    expect(result).toBe('hello [function] line 1');
  });

  it('uses 0-based LSP coordinates from 1-based input', async () => {
    const client = makeMockClient({ hover: vi.fn(async () => ({ contents: 'ok' })) });
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    await tool.execute({ operation: 'hover', file_path: 'sample.ts', line: 3, character: 5 });
    expect(client.hover).toHaveBeenCalledWith(expect.any(String), 2, 4);
  });

  it('returns error for unknown operation', async () => {
    const client = makeMockClient();
    const tool = createLspTool({ getLspClient: () => client as any, cwd: dir });
    const result = await tool.execute({ operation: 'unknownOp', file_path: 'sample.ts', line: 1, character: 1 });
    expect(result).toContain('Error');
    expect(result).toContain('unknownOp');
  });
});
