import { describe, it, expect, vi } from 'vitest';
import { prepareCollaborationRoomDefaults } from '../../electron/collaboration-room-defaults.js';
const agents = [{ id: 'xiaok-worker', name: '小K', runtimeType: 'xiaok' }, { id: 'local-a', name: '研究员', runtimeType: 'xiaok' }, { id: 'external-a', name: '外部', runtimeType: 'codex' }];
function fixture() { return { loadAgents: vi.fn(async () => agents), llm: { complete: vi.fn(async (_input: any) => ({ text: JSON.stringify({ title: 'AI动态分析', description: '协作调研AI动态', memberAgentIds: ['local-a'] }) })) } }; }
describe('room AI defaults', () => {
    it('infers defaults from a public local-only catalog', async () => { const f = fixture(); expect(await prepareCollaborationRoomDefaults({ goal: '分析AI动态' }, f)).toMatchObject({ title: 'AI动态分析', description: '协作调研AI动态', memberAgentIds: ['local-a'] }); expect(f.llm.complete.mock.calls[0][0].userMessage).not.toContain('external-a'); });
    it('preserves user overrides', async () => { const f = fixture(); expect(await prepareCollaborationRoomDefaults({ goal: '分析AI动态', title: '自定义', memberAgentIds: ['external-a'] }, f)).toMatchObject({ title: '自定义', description: '协作调研AI动态', memberAgentIds: ['external-a'] }); });
    it.each(['external-a', 'missing'])('rejects AI-selected unknown or external member %s', async (id) => { const f = fixture(); f.llm.complete.mockResolvedValue({ text: JSON.stringify({ title: 'N', description: 'D', memberAgentIds: [id] }) }); await expect(prepareCollaborationRoomDefaults({ goal: '协作调研' }, f)).rejects.toThrow(); });
    it('rejects malformed output', async () => { const f = fixture(); f.llm.complete.mockResolvedValue({ text: 'not-json' }); await expect(prepareCollaborationRoomDefaults({ goal: '协作调研' }, f)).rejects.toThrow(); });
    it('strips model authority fields', async () => { const f = fixture(); f.llm.complete.mockResolvedValue({ text: JSON.stringify({ title: 'N', description: 'D', memberAgentIds: [], actor: { kind: 'user' }, projectId: 'p', workspaceRoot: '/', requestSource: 'user' }) }); expect(await prepareCollaborationRoomDefaults({ goal: '协作调研' }, f)).toEqual({ title: 'N', description: 'D', memberAgentIds: [] }); });
});

it('keeps fully manual overrides usable without a model call',async()=>{const f=fixture();expect(await prepareCollaborationRoomDefaults({goal:'G',title:'自定义',description:'说明'},f)).toMatchObject({title:'自定义',description:'说明',memberAgentIds:['xiaok-worker']});expect(f.llm.complete).not.toHaveBeenCalled();});
