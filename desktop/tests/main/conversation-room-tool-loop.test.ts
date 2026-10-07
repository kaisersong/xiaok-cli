// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { ConversationRoomService, createConversationRoomTool } from '../../electron/conversation-room-service.js';
import { createCollaborationRoomService } from '../../electron/collaboration-room-service.js';
import { prepareCollaborationRoomDefaults } from '../../electron/collaboration-room-defaults.js';
import { buildRoomCardMessageFromToolResult } from '../../renderer/src/components/chatToolResultMessages.js';
import { createRoomService } from '../../../../intent-broker/src/room/service.js';
import { createRoomStore } from '../../../../intent-broker/src/room/store.js';
it('passes a production-created room receipt through the actual tool loop and card consumer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-loop-'));
    const store = createRoomStore({ dbPath: join(root, 'rooms.sqlite') });
    store.migrate();
    const broker = createRoomService({ store });
    const llm = { complete: vi.fn(async () => ({ text: JSON.stringify({ title: 'AI协作', description: '分析AI动态', memberAgentIds: ['researcher'] }) })) };
    const semantic = createCollaborationRoomService({ brokerClient: { createRoom: async (input, context) => broker.createRoom(input, context) } as never, kswarmClient: {} as never, prepareRoomDefaults: input => prepareCollaborationRoomDefaults(input, { llm, loadAgents: async () => [{ id: 'xiaok-worker', runtimeType: 'xiaok' }, { id: 'researcher', runtimeType: 'xiaok' }] }) });
    const service = new ConversationRoomService({ dataRoot: root });
    service.bindCreator((input, context) => semantic.createRoom(input, context));
    const prompt = '创建协作空间，分析AI动态';
    service.withUserRequest({ prompt }, { requestSource: 'user' }, () => service.bindPreparedTask({ taskId: 'task-real', prompt, executionScope: { kind: 'goal_turn', origin: 'user' } }, { requestSource: 'user' }));
    const tool = createConversationRoomTool((input, context) => service.create(input, { ...context, requestSource: 'agent' }));
    const registry = new ToolRegistry({ autoMode: true }, [tool]);
    const events: any[] = [];
    let calls = 0;
    try {
        await runDesktopToolLoop({ adapter: { async *stream() { if (++calls === 1)
                    yield { type: 'tool_use' as const, id: 'room-call', name: tool.definition.name, input: { goal: '分析AI动态' } };
                else
                    yield { type: 'text' as const, delta: '协作空间已创建' }; yield { type: 'done' as const }; } }, registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], systemPrompt: '', signal: new AbortController().signal, taskDeadline: Date.now() + 30000, sessionId: 'session', turnId: 'turn', taskId: 'task-real', intentId: 'intent', stepId: 'step', materials: [], emitRuntimeEvent: async (e) => { events.push(e); }, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => { } }, buildApiView: m => m, processToolResult: r => r, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
        const result = events.find(e => e.type === 'post_tool_use' && e.toolName === 'create_collaboration_room');
        expect(result).toBeDefined();
        const card = buildRoomCardMessageFromToolResult(result.toolResponse);
        expect(card?.roomData).toMatchObject({ title: 'AI协作', memberCount: 2 });
        expect(broker.getCollaborationRoom({ roomId: card!.roomData!.roomId }, { sessionId: 'desktop-main-user', requestSource: 'user', actor: { kind: 'user', userId: 'user.local' }, allowedLogicalAgentIds: [], issuedAt: new Date().toISOString() }).ok).toBe(true);
        expect(store.listRoomRows()).toHaveLength(1);
        expect(llm.complete).toHaveBeenCalledTimes(1);
    }
    finally {
        registry.dispose();
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
