import { expect, it } from 'vitest';
import * as repetition from '../../../src/ai/runtime/model-text-repetition.js';
import { RuntimeFacade } from '../../../src/ai/runtime/runtime-facade.js';
const code = 'MODEL_TEXT_REPETITION_DETECTED';
it('matches only code prefix chains', () => {
  for (const text of [code, `Error: ${code} (attempt 2/3)`, `model_failed: ${code}; provider=kimi`, `Error: model_failed: ${code}`]) expect(repetition.isModelTextRepetitionMessage(text)).toBe(true);
  for (const text of [`tool_failed: upstream said ${code}`, `Error: X${code}X`, `see log ${code}`]) expect(repetition.isModelTextRepetitionMessage(text)).toBe(false);
});
it('rejects a mention but follows structured causes with cycle protection', () => {
  expect(repetition.isModelTextRepetitionError(new Error(`upstream said ${code}`))).toBe(false);
  const cause = Object.assign(new Error('opaque'), { code });
  expect(repetition.isModelTextRepetitionError(new Error('outer', { cause }))).toBe(true);
  const cyclic = { message: 'ordinary', cause: null as unknown }; cyclic.cause = cyclic;
  expect(repetition.isModelTextRepetitionError(cyclic)).toBe(false);
});
it.each(['build', 'run'])('preserves original structured cause from facade %s failure', async phase => {
  const original = Object.assign(new Error('provider stream stopped'), { code });
  const facade = new RuntimeFacade({
    getPromptInput: async () => ({} as never),
    promptBuilder: { build: async () => { if (phase === 'build') throw original; return { id: 'p', memoryRefs: [], cwd: '/ws', rendered: 'system' } as never; } },
    agent: { getSessionState: () => ({ attachPromptSnapshot() {} }) as never, setPromptSnapshot() {}, setSystemPrompt() {}, runTurn: async () => { throw original; } },
  });
  await expect(facade.runTurn({ sessionId: 's', cwd: '/ws', source: 'chat', input: 'hello' }, () => {})).rejects.toHaveProperty('cause', original);
});
