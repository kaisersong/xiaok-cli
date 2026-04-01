import { describe, expect, it, vi } from 'vitest';
import { RuntimeFacade } from '../../../src/ai/runtime/runtime-facade.js';

describe('RuntimeFacade', () => {
  it('builds a prompt snapshot once and attaches it to the session before running the turn', async () => {
    const promptBuilder = {
      build: vi.fn().mockResolvedValue({
        id: 'prompt_1',
        rendered: 'system',
        memoryRefs: ['mem_1'],
        segments: [],
        createdAt: 1,
        cwd: '/repo',
        channel: 'chat',
      }),
    };
    const sessionState = {
      attachPromptSnapshot: vi.fn(),
    };
    const agent = {
      getSessionState: vi.fn(() => sessionState),
      setPromptSnapshot: vi.fn(),
      setSystemPrompt: vi.fn(),
      runTurn: vi.fn().mockResolvedValue(undefined),
    };

    const facade = new RuntimeFacade({
      promptBuilder,
      getPromptInput: async (cwd) => ({
        cwd,
        enterpriseId: null,
        devApp: null,
        budget: 2000,
        skills: [],
        deferredTools: [],
        agents: [],
        pluginCommands: [],
        lspDiagnostics: '',
      }),
      agent,
    });

    await facade.runTurn({ sessionId: 'sess_1', cwd: '/repo', source: 'chat', input: 'hello' }, () => {});

    expect(promptBuilder.build).toHaveBeenCalledOnce();
    expect(sessionState.attachPromptSnapshot).toHaveBeenCalledWith('prompt_1', ['mem_1']);
    expect(agent.setPromptSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'prompt_1' }));
  });
});
