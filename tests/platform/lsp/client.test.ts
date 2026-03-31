import { describe, expect, it, vi } from 'vitest';
import { createLspClient, decodeLspFrames, encodeLspMessage } from '../../../src/platform/lsp/client.js';
import { createLspManager } from '../../../src/platform/lsp/manager.js';

describe('lsp client framing', () => {
  it('encodes a Content-Length framed message', () => {
    const payload = encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(payload).toContain('Content-Length:');
    expect(payload).toContain('"method":"initialize"');
  });

  it('decodes framed messages from a byte stream', () => {
    const frame = encodeLspMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///a.ts', diagnostics: [] },
    });

    const messages = decodeLspFrames(frame);
    expect(messages).toEqual([
      expect.objectContaining({
        method: 'textDocument/publishDiagnostics',
      }),
    ]);
  });

  it('initializes and applies incoming diagnostics notifications through the client transport', async () => {
    const manager = createLspManager();
    const listeners = new Set<(message: { jsonrpc: '2.0'; method?: string; params?: Record<string, unknown> }) => void>();
    const transport = {
      send: vi.fn(async (message: { jsonrpc: '2.0'; id?: number; method?: string }) => {
        if (message.method === 'initialize') {
          return { jsonrpc: '2.0' as const, id: message.id, result: { capabilities: {} } };
        }
        return undefined;
      }),
      onMessage(handler: (message: { jsonrpc: '2.0'; method?: string; params?: Record<string, unknown> }) => void) {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    };
    const client = createLspClient(transport, manager);

    await client.initialize('file:///repo');
    listeners.forEach((listener) => listener({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Type error' }],
      },
    }));

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(manager.getSummary()).toContain('Type error');
  });
});
