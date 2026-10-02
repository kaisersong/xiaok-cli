import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createComputerUseTool } from '../../../src/ai/tools/computer-use.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import type { Message } from '../../../src/types.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

describe('CUA invocation image to actual desktop adapter request', () => {
  it.each([true, false, undefined])('uses actual adapter image capability %s', async supports => {
    const root = mkdtempSync(join(tmpdir(), 'cua-media-'));
    const call = vi.fn(async () => ({ text: 'fixture', images: [{ mimeType: 'image/png', data: png }], structuredContent: { pid: 123, window_id: 456 }, isError: false, summary: 'fixture' }));
    const tool = createComputerUseTool({ requiresImageInput: true, callToolResult: call });
    const registry = new ToolRegistry({ autoMode: true }, [tool]);
    const requests: Message[][] = [];
    let turn = 0;
    try {
      await runDesktopToolLoop({
        adapter: {
          getCapabilities: () => supports === undefined ? {} : { supportsImageInput: supports },
          async *stream(messages: Message[]) {
            requests.push(structuredClone(messages));
            if (++turn === 1) yield { type: 'tool_use' as const, id: 'capture-1', name: tool.definition.name, input: { action: 'capture', pid: 123, window_id: '456' } };
            else yield { type: 'text' as const, delta: 'done' };
            yield { type: 'done' as const };
          },
        },
        registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: 'observe test window' }] }],
        systemPrompt: '', signal: new AbortController().signal, taskDeadline: Date.now() + 30_000,
        sessionId: 'media-session', turnId: 'media-turn', taskId: 'media-task', intentId: 'intent', stepId: 'step',
        materials: [], emitRuntimeEvent: vi.fn(async () => {}), skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(),
        strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
          buildApiView: msgs => msgs, processToolResult: value => value, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
      });
      const images = requests[1].flatMap(message => message.content).filter(block => block.type === 'image');
      if (supports === true) {
        expect(call).toHaveBeenCalledOnce();
        expect(images).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }]);
        expect(Buffer.from(images[0].source.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
        expect(requests[1].flatMap(message => message.content).filter(b => b.type === 'tool_result').map(b => b.content).join()).not.toContain(png);
      } else {
        expect(call).not.toHaveBeenCalled();
        expect(images).toEqual([]);
        expect(JSON.stringify(requests[1])).toContain('COMPUTER_USE_MODEL_IMAGE_DISABLED');
      }
    } finally { registry.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
});
