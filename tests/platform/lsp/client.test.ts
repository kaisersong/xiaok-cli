import { describe, expect, it } from 'vitest';
import { decodeLspFrames, encodeLspMessage } from '../../../src/platform/lsp/client.js';

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
});
