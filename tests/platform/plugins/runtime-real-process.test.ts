import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLspManager } from '../../../src/platform/lsp/manager.js';
import { connectDeclaredLspServer, connectDeclaredMcpServer } from '../../../src/platform/plugins/runtime.js';

function quote(value: string): string {
  return JSON.stringify(value);
}

describe('platform plugin runtime real process', () => {
  it('connects to real MCP and LSP stdio fixtures', async () => {
    const mcpCommand = `${quote(process.execPath)} ${quote(join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js'))}`;
    const lspCommand = `${quote(process.execPath)} ${quote(join(process.cwd(), 'tests', 'support', 'lsp-stdio-server.js'))}`;

    const mcp = await connectDeclaredMcpServer({
      name: 'fixture-docs',
      command: mcpCommand,
    });
    const manager = createLspManager();
    const lsp = await connectDeclaredLspServer(
      {
        name: 'fixture-lsp',
        command: lspCommand,
      },
      manager,
      'file:///repo',
    );

    await expect(mcp.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'search' }),
    ]);
    await expect(mcp.callTool('search', { q: 'prompt cache' })).resolves.toBe('fixture:prompt cache');
    await expect(lsp.didOpenDocument({
      uri: 'file:///repo/src/app.ts',
      languageId: 'typescript',
      text: 'const x: string = 1;',
    })).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manager.getSummary()).toContain('fixture diagnostic');

    lsp.dispose();
    mcp.dispose();
  });
});
