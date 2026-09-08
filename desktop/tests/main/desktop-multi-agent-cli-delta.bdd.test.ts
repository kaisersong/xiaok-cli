// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ModelAdapter } from '../../../src/types.js';
import type { CustomAgentDef } from '../../../src/ai/agents/loader.js';
import { buildToolList } from '../../../src/ai/tools/index.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentRuntime } from '../../electron/desktop-multi-agent-runtime.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('BDD: CLI delta reaches the actual Desktop child tool surface', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  it.each([
    { name: 'inline uppercase', selected: ['Read', 'Grep'], preset: undefined, reads: true },
    { name: 'preset lowercase intersect uppercase', selected: ['Read', 'Grep'], preset: ['read', 'grep'], reads: true },
    { name: 'explicit empty inline', selected: [], preset: undefined, reads: false },
    { name: 'empty preset cannot expand', selected: ['Read', 'Grep'], preset: [], reads: false },
    { name: 'empty intersection cannot expand', selected: ['Write'], preset: ['read', 'grep'], reads: false },
  ])('Given $name, When a real child tries Read/Grep/write, Then discovered tools and actual permissions agree', async scenario => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ma-cli-delta-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const source = join(root, 'fixture.ts'), forbidden = join(root, 'forbidden.txt'); writeFileSync(source, 'export const REAL_READ_GREP_SENTINEL = 42;\n');
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    let runtime!: DesktopMultiAgentRuntime;
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: input => runtime.createSession(input) });
    cleanup.push(() => service.dispose()); runtime = new DesktopMultiAgentRuntime({ service });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const broad = new DesktopOwnedToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: root }));
    const catalog = new DesktopToolCatalogBridge({ registry: broad, workspaceId: 'workspace' }); cleanup.push(() => { catalog.dispose(); broad.dispose(); }); catalog.authorizeRoot();
    const history: Message[][] = []; const toolNames: string[][] = [];
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages, tools) {
      history.push(structuredClone(messages)); toolNames.push(tools.map(tool => tool.name));
      if (history.length === 1) {
        yield { type: 'tool_use', id: 'same-id-read', name: 'Read', input: { file_path: source } };
        yield { type: 'tool_use', id: 'grep', name: 'Grep', input: { path: source, pattern: 'REAL_READ_GREP_SENTINEL' } };
        yield { type: 'tool_use', id: 'forbidden-write', name: 'write', input: { file_path: forbidden, content: 'MUST_NOT_EXIST' } };
      } else yield { type: 'text', delta: 'inspection completed' };
    } };
    const materialRegistry = new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 });
    let childId = '', groupId = ''; const errors: unknown[] = [];
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry,
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }), runner: input => service.runRoot(input, async context => {
        groupId = context.groupId;
        const agents: CustomAgentDef[] = scenario.preset === undefined ? [] : [{ name: 'preset', systemPrompt: 'read only', allowedTools: scenario.preset }];
        const scope = runtime.bindRoot(context, { adapter, catalog: catalog.catalog, policy: catalog.catalog.snapshotPolicy(), systemPrompt: 'Inspect',
          workspaceId: 'workspace', materialIds: [], permissionRevision: 0, registryOptions: { autoMode: true }, materials: [], materialRegistry,
          skillCatalog: createSkillCatalog(undefined, root), dataRoot: root, agents, emitRuntimeEvent: input.emitRuntimeEvent, maxIterations: 3 });
        try {
          const result = await scope.registry.executeTool('spawn_agent', { task_name: 'inspect', message: 'Inspect fixture', tools: scenario.selected,
            ...(scenario.preset === undefined ? {} : { agent: 'preset' }) });
          childId = JSON.parse(result).targetAgentId;
        } catch (error) { errors.push(error); throw error; } finally { scope.dispose(); }
      }) });
    await service.initialize(host); const task = await service.prepareRoot(host, 'thread', { prompt: 'read fixture', materials: [] });
    await host.startTask(task.taskId); await host.drain(); expect(errors).toEqual([]); expect(childId).toBeTruthy();
    await vi.waitFor(() => expect(store.getAgent(groupId, childId)?.executionActive).toBe(false));
    expect(history).toHaveLength(2);
    const results = history[1].flatMap(message => message.content).filter(block => block.type === 'tool_result');
    const read = results.find(block => block.type === 'tool_result' && block.tool_use_id === 'same-id-read');
    const grep = results.find(block => block.type === 'tool_result' && block.tool_use_id === 'grep');
    expect(JSON.stringify(read)).toMatch(scenario.reads ? /REAL_READ_GREP_SENTINEL/ : /Error|unknown/i);
    expect(JSON.stringify(grep)).toMatch(scenario.reads ? /REAL_READ_GREP_SENTINEL/ : /Error|unknown/i);
    expect(toolNames[0].includes('read')).toBe(scenario.reads); expect(toolNames[0].includes('grep')).toBe(scenario.reads);
    expect(toolNames[0]).not.toContain('write'); expect(existsSync(forbidden)).toBe(false);
  });
});
