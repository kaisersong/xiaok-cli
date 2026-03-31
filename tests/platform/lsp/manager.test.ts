import { describe, expect, it } from 'vitest';
import { createLspManager } from '../../../src/platform/lsp/manager.js';

describe('lsp manager', () => {
  it('captures diagnostics summaries by uri', () => {
    const manager = createLspManager();

    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Type error' }],
      },
    });

    expect(manager.getDiagnostics('file:///repo/src/app.ts')).toEqual([
      expect.objectContaining({ message: 'Type error' }),
    ]);
    expect(manager.getSummary()).toContain('Type error');
  });
});
