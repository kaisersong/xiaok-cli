// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

describe('ordinary Desktop production tool loop recovery', () => {
  it.each([false, true])('continues a disconnected tool turn; partial tool emitted=%s', async partialTool => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-request-recovery-')); const executed: string[] = [], requests: any[] = [], events: any[] = []; let turn = 0;
    const registry = new ToolRegistry({ autoMode: true }, [{ definition: { name: 'record', description: '', inputSchema: { type: 'object', properties: {} } },
      async execute(input: any) { executed.push(input.label); return 'saved:' + input.label; } }]);
    try {
      const result = await runDesktopToolLoop({ adapter: { async *stream(messages: any) {
        requests.push(structuredClone(messages)); turn++;
        if (turn === 1) yield { type: 'tool_use' as const, id: 'completed', name: 'record', input: { label: 'completed' } };
        else if (turn === 2) { if (partialTool) yield { type: 'tool_use' as const, id: 'discarded', name: 'record', input: { label: 'discarded' } }; throw new Error('terminated'); }
        else if (turn === 3 && partialTool) yield { type: 'tool_use' as const, id: 'fresh', name: 'record', input: { label: 'fresh' } };
        else yield { type: 'text' as const, delta: 'done after recovery' };
        yield { type: 'done' as const };
      } }, registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: 'finish' }] }],
      systemPrompt: '', signal: new AbortController().signal, taskDeadline: Date.now() + 30000, sessionId: 'sess', turnId: 'turn', taskId: 'task', intentId: 'intent', stepId: 'step',
      materials: [], emitRuntimeEvent: async e => { events.push(e); }, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(),
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: m => m, processToolResult: r => r,
        trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
      expect(result.reply).toContain('done after recovery'); expect(executed).toEqual(partialTool ? ['completed', 'fresh'] : ['completed']);
      expect(JSON.stringify(requests[2])).toContain('saved:completed'); expect(JSON.stringify(requests[2])).not.toContain('discarded');
      expect(events.some(e => e.type === 'execution_health' && e.state === 'recovering')).toBe(true);
    } finally { registry.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
});
