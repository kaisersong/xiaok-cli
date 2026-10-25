import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { InvocationToolImages } from '../../../src/ai/runtime/tool-image-channel.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'xiaok-read-image-observation-')); roots.push(cwd);
  const signal = new AbortController().signal, images = new InvocationToolImages(signal, true);
  const append = vi.fn(), finalize = vi.fn(), begin = vi.fn(() => ({ append, finalize }));
  const context = mcpTestContext(signal, { modelSupportsImageInput: true, emitToolImage: images.emit, observationCollector: { begin } });
  return { cwd, images, context, append, finalize, begin, read: createReadTool({ cwd }) };
}

describe('read visual channel and selected-text observation coexist', () => {
  it('delivers validated real PNG only through the actual image port, without a text capture', async () => {
    const f = fixture(), file = join(f.cwd, 'screen.png'), bytes = readFileSync(join(process.cwd(), 'tests/fixtures/images/read-image.png'));
    writeFileSync(file, bytes);
    try {
      const reply = await f.read.execute({ file_path: file, max_chars: 1 }, f.context);
      expect(reply).not.toMatch(/^Error:/); expect(reply).not.toContain(bytes.toString('base64'));
      expect(f.images.finish(true)).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } }]);
      expect(f.begin).not.toHaveBeenCalled(); expect(f.append).not.toHaveBeenCalled(); expect(f.finalize).not.toHaveBeenCalled();
    } finally { f.images.finish(false); }
  });

  it('retains selected text before preview cap even with a host image channel attached', async () => {
    const f = fixture(), file = join(f.cwd, 'log.txt');
    writeFileSync(file, 'UNREQUESTED_START\n' + 'x'.repeat(300) + '\nSELECTED_TAIL\nUNREQUESTED_END');
    try {
      const reply = await f.read.execute({ file_path: file, offset: 2, limit: 2, max_chars: 60 }, f.context);
      expect(reply).not.toContain('SELECTED_TAIL');
      expect(f.begin).toHaveBeenCalledWith({ toolName: 'read', source: { filePath: file, offset: 2, limit: 2 } });
      const captured = f.append.mock.calls.map(([text]) => text).join('');
      expect(captured).toContain('SELECTED_TAIL'); expect(captured).not.toContain('UNREQUESTED');
      expect(f.finalize).toHaveBeenCalledExactlyOnceWith({ executionState: 'terminal', outcome: 'success' });
      expect(f.images.finish(true)).toEqual([]);
    } finally { f.images.finish(false); }
  });

  it('pre-cancellation wins over a missing file and never starts capture or image delivery', async () => {
    const f = fixture(), reason = new DOMException('original stop A', 'AbortError');
    try {
      const context = { ...f.context, signal: AbortSignal.abort(reason) };
      await expect(f.read.execute({ file_path: join(f.cwd, 'missing.png') }, context)).rejects.toBe(reason);
      expect(f.begin).not.toHaveBeenCalled(); expect(f.images.finish(true)).toEqual([]);
    } finally { f.images.finish(false); }
  });
});
