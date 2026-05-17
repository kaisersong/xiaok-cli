import { describe, expect, it, vi } from 'vitest';
import { createSubAgentTool } from './subagent.js';
// Mock executeNamedSubAgent
vi.mock('../agents/subagent-executor.js', () => ({
    executeNamedSubAgent: vi.fn().mockResolvedValue('subagent result'),
}));
import { executeNamedSubAgent } from '../agents/subagent-executor.js';
const mockAdapter = () => ({
    generate: vi.fn(),
    stream: vi.fn(),
});
const mockBuildSystemPrompt = async () => 'xiaok system prompt';
function mockRegistry() {
    return {
        getTool: () => undefined,
        list: () => [],
        capabilities: () => [],
        getToolDefinitions: () => [],
    };
}
const baseOptions = {
    source: 'chat',
    sessionId: 'test-session',
    adapter: mockAdapter,
    agents: [],
    createRegistry: () => mockRegistry(),
    buildSystemPrompt: mockBuildSystemPrompt,
};
describe('subagent tool', () => {
    describe('inline agent mode', () => {
        it('creates inline agent with description and prompt', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'code review',
                prompt: 'Check for bugs in src/main.ts',
            }, {});
            expect(executeNamedSubAgent).toHaveBeenCalled();
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.name).toBe('inline');
            expect(call.agentDef.source).toBe('project');
            expect(call.agentDef.systemPrompt).toBe('');
        });
        it('filters out subagent tool from inline agent allowedTools', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'recursive test',
                prompt: 'do something',
                tools: ['Read', 'Edit', 'subagent'],
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.allowedTools).toEqual(['Read', 'Edit']);
        });
        it('allows inline agent with empty tools list', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'simple task',
                prompt: 'summarize',
                tools: [],
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.allowedTools).toBeUndefined();
        });
        it('supports custom name for inline agent', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'test',
                prompt: 'do something',
                name: 'my-reviewer',
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.name).toBe('my-reviewer');
        });
        it('supports model override for inline agent', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'test',
                prompt: 'do something',
                model: 'opus',
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.model).toBe('opus');
        });
        it('supports worktree isolation for inline agent', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            await tool.execute({
                description: 'test',
                prompt: 'do something',
                isolation: 'worktree',
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.isolation).toBe('worktree');
        });
    });
    describe('pre-defined agent mode', () => {
        const agents = [
            { name: 'reviewer', systemPrompt: 'You are a reviewer', source: 'builtin' },
            { name: 'planner', systemPrompt: 'You are a planner', source: 'builtin' },
        ];
        it('calls pre-defined agent', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: agents });
            await tool.execute({
                agent: 'reviewer',
                prompt: 'Review the code',
            }, {});
            expect(executeNamedSubAgent).toHaveBeenCalled();
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.name).toBe('reviewer');
            expect(call.agentDef.systemPrompt).toBe('You are a reviewer');
        });
        it('returns error for unknown agent', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: agents });
            const result = await tool.execute({
                agent: 'nonexistent',
                prompt: 'do something',
            }, {});
            expect(result).toContain('Error: unknown agent');
            expect(result).toContain('nonexistent');
        });
        it('inline mode takes precedence when agent is not specified', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: agents });
            await tool.execute({
                description: 'custom task',
                prompt: 'do something custom',
                tools: ['Read'],
            }, {});
            const call = executeNamedSubAgent.mock.calls[0][0];
            expect(call.agentDef.name).toBe('inline');
        });
    });
    describe('validation', () => {
        it('returns error when prompt is empty', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            const result = await tool.execute({
                description: 'test',
                prompt: '',
            }, {});
            expect(result).toContain('Error: prompt is required');
        });
        it('returns error when prompt is whitespace only', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            const result = await tool.execute({
                description: 'test',
                prompt: '   ',
            }, {});
            expect(result).toContain('Error: prompt is required');
        });
    });
    describe('background mode', () => {
        const mockBackgroundRunner = {
            start: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
        };
        it('queues background job for pre-defined agent', async () => {
            const agents = [{ name: 'reviewer', systemPrompt: '', source: 'builtin' }];
            const tool = createSubAgentTool({
                ...baseOptions,
                agents: agents,
                backgroundRunner: mockBackgroundRunner,
            });
            const result = await tool.execute({
                agent: 'reviewer',
                prompt: 'Review code',
                background: true,
            }, {});
            expect(result).toContain('background agent queued');
            expect(result).toContain('job-123');
            expect(mockBackgroundRunner.start).toHaveBeenCalled();
        });
        it('queues background job for inline agent', async () => {
            const tool = createSubAgentTool({
                ...baseOptions,
                agents: [],
                backgroundRunner: mockBackgroundRunner,
            });
            const result = await tool.execute({
                description: 'background task',
                prompt: 'do something in background',
                background: true,
            }, {});
            expect(result).toContain('background agent queued');
        });
        it('returns error when background runner not configured', async () => {
            const tool = createSubAgentTool({ ...baseOptions, agents: [] });
            const result = await tool.execute({
                description: 'test',
                prompt: 'do something',
                background: true,
            }, {});
            expect(result).toContain('Error: background runner is not configured');
        });
    });
});
describe('subagent tool description', () => {
    it('includes pre-defined agent names in description', () => {
        const agents = [
            { name: 'reviewer', systemPrompt: '', source: 'builtin' },
            { name: 'planner', systemPrompt: '', source: 'builtin' },
        ];
        const tool = createSubAgentTool({
            source: 'chat',
            sessionId: 'test',
            adapter: mockAdapter,
            agents: agents,
            createRegistry: () => mockRegistry(),
            buildSystemPrompt: mockBuildSystemPrompt,
        });
        const desc = tool.definition.description;
        expect(desc).toContain('reviewer');
        expect(desc).toContain('planner');
        expect(desc).toContain('inline');
        expect(desc).toContain('subagent');
    });
    it('explains both modes clearly', () => {
        const tool = createSubAgentTool({
            ...baseOptions,
            agents: [],
        });
        const desc = tool.definition.description;
        expect(desc).toContain('Pre-defined agent');
        expect(desc).toContain('Inline agent');
        expect(desc).toContain('recursion');
    });
});
