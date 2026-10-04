import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, ToolExecutionContext } from '../../../src/types.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createReadTool } from '../../../src/ai/tools/read.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

describe('CLI invocation image delivery', () => {
  it('runs real read through registry and sends the image with its tool result to the next model turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-read-image-runtime-'));
    const file = join(dir, 'screen.png'); writeFileSync(file, Buffer.from(png, 'base64'));
    const session = new AgentSessionState();
    let calls = 0;
    let observed: Message[] = [];
    const adapter = {
      getModelName: () => 'test-vision',
      getCapabilities: () => ({ supportsImageInput: true }),
      async *stream(messages: Message[]) {
        if (++calls === 1) yield { type: 'tool_use' as const, id: 'read_screen', name: 'read', input: { file_path: file } };
        else { observed = structuredClone(messages); yield { type: 'text' as const, delta: 'received image' }; }
        yield { type: 'done' as const };
      },
    };
    const registry = new ToolRegistry({ autoMode: true }, [createReadTool({ cwd: dir })]);
    try {
      const runtime = new AgentRuntime({ adapter, registry, session, controller: new AgentRunController(), systemPrompt: 'system' });
      await runtime.run('inspect screen', () => {});
      const resultMessage = observed.find(m => m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'read_screen'));
      expect(resultMessage?.content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } });
      expect(resultMessage?.content.find(b => b.type === 'tool_result')).toMatchObject({ is_error: false });
      expect(session.getMessages().some(m => m.content.some(b => b.type === 'image'))).toBe(true);
    } finally { registry.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['failure', 'abort'] as const)('drops invocation images on %s and closes the media port', async failure => {
    const session = new AgentSessionState();
    const controller = new AgentRunController();
    let emit: ToolExecutionContext['emitToolImage'];
    const adapter = {
      getModelName: () => 'test-vision', getCapabilities: () => ({ supportsImageInput: true }),
      async *stream() { yield { type: 'tool_use' as const, id: 'call', name: 'probe', input: {} }; yield { type: 'done' as const }; },
    };
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'probe', description: 'test', inputSchema: { type: 'object' } },
      async execute(_input, ctx) { emit = ctx!.emitToolImage; emit!({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }); if (failure === 'abort') controller.abortActiveRun(); return 'Error: failed'; } }]);
    try {
      const runtime = new AgentRuntime({ adapter, registry, session, controller, systemPrompt: 'system', maxIterations: 1 });
      if (failure === 'abort') await expect(runtime.run('probe', () => {})).rejects.toMatchObject({ name: 'AbortError' });
      else await runtime.run('probe', () => {});
      expect(session.getMessages().flatMap(m => m.content).some(b => b.type === 'image')).toBe(false);
      expect(emit).toBeTypeOf('function');
      expect(() => emit!({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } })).toThrow();
    } finally { registry.dispose(); }
  });
});
