// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { compileRenderUiToA2ui, validateA2uiMessages } from '../../../src/a2ui/index.js';
describe('Desktop production GenUI streaming', () => {
  it.each([true, false])('previews only enabled tool definitions, enabled=%s', async (enabled) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-genui-loop-'));
    const events: any[] = [];
    const registry = new ToolRegistry({ autoMode: true }, []);
    try {
      await runDesktopToolLoop({
        adapter: {
          async *stream() {
            yield {
              type: 'ui_preview',
              id: 'call',
              input:
                '{"title":"Live","output_path":"SECRET","sections":[{"kind":"text","content":"Preview"},',
            } as never;
            yield { type: 'text', delta: 'Done' };
            yield { type: 'done' };
          },
        },
        registry,
        allToolDefs: enabled
          ? [
              {
                name: 'render_ui',
                description: '',
                inputSchema: { type: 'object', properties: {} },
              },
            ]
          : [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Show analysis' }] }],
        systemPrompt: '',
        signal: new AbortController().signal,
        taskDeadline: Date.now() + 30000,
        sessionId: 'sess',
        turnId: 'turn',
        taskId: 'task',
        intentId: 'intent',
        stepId: 'step',
        materials: [],
        emitRuntimeEvent: async (e) => {
          events.push(e);
        },
        skillInvocation: null,
        skillCatalog: {} as never,
        dataRoot: root,
        taskStartTime: Date.now(),
        strategies: {
          compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
          buildApiView: (m) => m,
          processToolResult: (r) => r,
          trackAutoProgress: false,
          trackReferenceReads: false,
          emitSkillArtifactTrace: false,
        },
      });
      const previews = events.filter((e) => e.type === 'ui_preview');
      if (!enabled) {
        expect(previews).toHaveLength(0);
        return;
      }
      expect(previews[0].preview.title).toBe('Live');
      expect(validateA2uiMessages(JSON.parse(previews[0].preview.content))).toEqual({ ok: true });
      expect(JSON.stringify(previews)).not.toContain('SECRET');
      expect(previews.at(-1).preview).toBeNull();
    } finally {
      registry.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('publishes previews only to live UI subscriptions, excluding snapshots, record journals and replay', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-genui-host-'));
    let send!: (contentOverride?: string) => Promise<void>;
    let finish!: () => void;
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    const content = JSON.stringify(
      compileRenderUiToA2ui(
        { title: 'Live', sections: [{ kind: 'text', content: 'Preview' }] },
        { taskId: 'task', toolUseId: 'call' },
      ).messages,
    );
    const store = new FileTaskSnapshotStore(join(root, 'snapshots'));
    const host = new InProcessTaskRuntimeHost({
      snapshotStore: store,
      materialRegistry: new MaterialRegistry({
        workspaceRoot: join(root, 'workspace'),
        maxBytes: 1000000,
      }),
      createTaskId: () => 'task',
      runner: async (input) => {
        send = (contentOverride = content) =>
          input.emitRuntimeEvent({
            type: 'ui_preview',
            sessionId: input.sessionId,
            turnId: 'turn',
            toolUseId: 'call',
            preview: { title: 'Live', content: contentOverride },
          } as never);
        await pending;
      },
    });
    try {
      await host.createTask({ prompt: 'Show report', materials: [] });
      while (!send) await new Promise((r) => setTimeout(r, 1));
      const snap = await store.recoverTask('task');
      const controller = new AbortController();
      const live = host
        .subscribeTask('task', { sinceIndex: snap!.events.length, signal: controller.signal })
        [Symbol.asyncIterator]();
      const next = live.next();
      await new Promise((r) => setTimeout(r, 5));
      await send();
      expect((await next).value).toMatchObject({ type: 'ui_preview' });
      const bad = live.next();
      await expect(send('invalid')).resolves.toBeUndefined();
      expect((await bad).value).toMatchObject({ type: 'ui_preview', preview: null });
      expect(JSON.stringify(await store.recoverTask('task'))).not.toContain('ui_preview');
      controller.abort();
      await live.return?.();
      finish();
      await host.drain();
      const replay = [];
      for await (const record of host.subscribeTaskRecords('task')) replay.push(record);
      expect(JSON.stringify(replay)).not.toContain('ui_preview');
    } finally {
      finish();
      await host.drain();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
