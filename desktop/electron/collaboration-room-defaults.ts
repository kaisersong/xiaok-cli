import type { LoopLLMPort } from './loop-llm-port.js';
type Agent = {
    id: string;
    name?: string;
    runtimeType?: string;
    archivedAt?: unknown;
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export async function prepareCollaborationRoomDefaults(input: Record<string, unknown>, ports: {
    loadAgents(): Promise<Agent[]>;
    llm: Pick<LoopLLMPort, 'complete'>;
    signal?: AbortSignal;
}) {
    const goal = text(input.goal);
    if (!goal || goal.length > 8000)
        throw Error('room_goal_invalid');
    const agents = (await ports.loadAgents()).filter(a => a.id && !a.archivedAt);
    const local = agents.filter(a => a.runtimeType === 'xiaok' || a.id === 'xiaok-worker' || a.id === 'xiaok-po').map(a => ({ id: a.id, name: a.name }));
    const manualTitle = text(input.title), manualDescription = text(input.description);
    if (manualTitle && manualDescription) {
        const members = Array.isArray(input.memberAgentIds) ? input.memberAgentIds : ['xiaok-worker'];
        if (manualTitle.length > 200 || manualDescription.length > 8000 || new Set([...members, 'xiaok-worker']).size > 6 || members.some(id => typeof id !== 'string' || !agents.some(agent => agent.id === id))) throw Error('room_defaults_members_invalid');
        return { title: manualTitle, description: manualDescription, memberAgentIds: [...new Set(members as string[])] };
    }
    const response = await ports.llm.complete({ model: 'fast', systemPrompt: '根据用户协作目标返回 JSON：{"title":"简短名称","description":"清晰的协作目标与分工","memberAgentIds":["id"]}。只从给定本地智能体选择合适成员，默认一至三个（数量包含小K，成员列表包含 xiaok-worker），名称与说明沿用用户目标的语言，不创造ID，不加入外部成员，不输出权限、路径或项目字段。尊重提供的用户覆盖。', userMessage: JSON.stringify({ goal, agents: local, overrides: { title: text(input.title) || undefined, description: text(input.description) || undefined } }), maxTokens: 1000, temperature: 0, signal: ports.signal });
    const parsed = JSON.parse(response.text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw Error('room_defaults_invalid');
    const title = text(input.title) || text(parsed.title), description = text(input.description) || text(parsed.description);
    if (!title || title.length > 200 || !description || description.length > 8000)
        throw Error('room_defaults_invalid');
    const explicit = Array.isArray(input.memberAgentIds), members = explicit ? input.memberAgentIds : parsed.memberAgentIds;
    if (!Array.isArray(members) || new Set([...members, 'xiaok-worker']).size > 6 || members.some(id => typeof id !== 'string' || !(explicit ? agents : local).some(a => a.id === id)))
        throw Error('room_defaults_members_invalid');
    return { title, description, memberAgentIds: [...new Set(members as string[])] };
}
