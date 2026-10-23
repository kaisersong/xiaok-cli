import { describe, expect, it } from 'vitest';
import { resolveProductionCapacityProfile, checkRequestCapacity } from '../../../src/runtime/sol-pi/capacity-admission.js';
import { inspectDeepSeekRecipeEnvironment, freezeDeepSeekRecipeCounter } from '../../../src/runtime/sol-pi/deepseek-capacity-profile.js';

const identity = { destination: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-flash', protocol: 'openai_legacy', profileId: 'generic-openai' };
const fixture = [
  { body: { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], thinking: { type: 'disabled' }, max_tokens: 1, stream: false }, tokens: 7 },
  { body: { model: 'deepseek-flash', messages: [{ role: 'system', content: 'Synthetic token calibration. Reply OK.' }, { role: 'user', content: 'Check label alpha.' }, { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'label', arguments: '{"value":"alpha"}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' }, { role: 'user', content: 'Reply OK.' }], tools: [{ type: 'function', function: { name: 'label', description: 'Synthetic label check.', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } }], thinking: { type: 'disabled' }, max_tokens: 1, stream: false }, tokens: 327 },
  { body: { model: 'deepseek-flash', messages: [{ role: 'system', content: 'Synthetic calibration only.' }, { role: 'user', content: 'Say OK.' }], thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 1, stream: false }, tokens: 38 },
];

describe('official DeepSeek production capacity qualification', () => {
  it('does not promote missing or forged host counter credentials', () => {
    for (const counter of [undefined, {}, { qualification: 'production', sha256: 'trusted', count: () => 7 }]) {
      expect(resolveProductionCapacityProfile({ ...identity, counter: counter as never })).toBeUndefined();
    }
    expect(() => freezeDeepSeekRecipeCounter({} as never)).toThrow();
  });
  it('rejects unknown platform and missing environment without spawning anything', () => {
    expect(() => inspectDeepSeekRecipeEnvironment({ pythonExecutable: 'missing', sitePackages: 'missing', tokenizerPath: 'missing', wheelPath: 'missing' })).toThrow();
  });

  // These tests consume the real official package, never a fabricated count callback.
  // CI with no host-prepared environment cannot claim this integration bucket passed.
  const environment = process.env.SOL_PI_DEEPSEEK_COUNTER_ENV;
  it.skipIf(!environment)('counts frozen real official fixtures and rejects unknown wire contracts', async () => {
    const { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const hostOptions = JSON.parse(readFileSync(environment!, 'utf8'));
    const temp = mkdtempSync(join(tmpdir(), 'sol-pi-counter-'));
    cpSync(hostOptions.tokenizerPath, join(temp, 'tokenizer.json'));
    cpSync(hostOptions.sitePackages, join(temp, 'site-packages'), { recursive: true });
    const options = { ...hostOptions, tokenizerPath: join(temp, 'tokenizer.json'), sitePackages: join(temp, 'site-packages') };
    try {
    const manifest = inspectDeepSeekRecipeEnvironment(options);
    const counter = freezeDeepSeekRecipeCounter({ ...options, environmentManifest: manifest });
    const profile = resolveProductionCapacityProfile({ ...identity, counter });
    expect(profile).toBeDefined();
    for (const { body, tokens } of fixture) {
      const result = checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(body) });
      expect(result.inputTokenUpperBound).toBe(tokens);
      expect(result.qualification).toBe('official-deepseek-recipe');
    }
    const noLimit = { ...fixture[0].body } as Record<string, unknown>;
    delete noLimit.max_tokens;
    expect(checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(noLimit) }).actualOutputReserve).toBe(393216);
    const thinkingHistory = JSON.parse(JSON.stringify(fixture[1].body));
    thinkingHistory.thinking = { type: 'enabled' };
    thinkingHistory.messages.pop();
    thinkingHistory.messages[2].reasoning_content = 'Synthetic reasoning. '.repeat(100);
    const withReasoning = checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(thinkingHistory) });
    thinkingHistory.messages[2].reasoning_content = 'Short.';
    const shortReasoning = checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(thinkingHistory) });
    expect(withReasoning.inputTokenUpperBound).toBeGreaterThan(shortReasoning.inputTokenUpperBound);
    // JSON Schema property names are user data, not protocol keys.
    thinkingHistory.tools[0].function.parameters = { type: 'object', properties: { unknownProtocolName: { type: 'string' } }, $defs: { Custom: { type: 'string' } } };
    expect(checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(thinkingHistory) }).inputTokenUpperBound).toBeGreaterThan(0);
    for (const change of [{ model: 'deepseek-v4.1-flash-expires-on-0910' }, { destination: 'https://other.test/v1/chat/completions' }, { destination: identity.destination + '?x=1' }, { profileId: 'other' }, { protocol: 'anthropic' }]) {
      expect(resolveProductionCapacityProfile({ ...identity, ...change, counter })).toBeUndefined();
    }
    for (const change of [{ unknown: true }, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }, { thinking: { type: 'enabled', unknown: 1 } }, { max_tokens: 393217 }, { max_completion_tokens: 1 }, { stream_options: { include_usage: true, unknown: true } }]) {
      expect(() => checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify({ ...fixture[0].body, ...change }) })).toThrow();
    }
    for (const invalidSchema of [{ type: 7 }, { required: 'x' }, { enum: 5 }, { format: 'unknown-format' }, { $ref: 'https://other.example/schema' }, { properties: { safe: { type: 'string', unknown: true } } }]) {
      const invalid = JSON.parse(JSON.stringify(fixture[1].body)); invalid.tools[0].function.parameters = invalidSchema;
      expect(() => checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(invalid) })).toThrow();
    }
    // Recheck every invocation: dependency changes invalidate an already issued cap.
    const tokenBytes = readFileSync(options.tokenizerPath);
    writeFileSync(options.tokenizerPath, '{}');
    expect(() => checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(fixture[0].body) })).toThrow();
    writeFileSync(options.tokenizerPath, tokenBytes);
    const init = join(options.sitePackages, 'deepseek_recipe', '__init__.py');
    const initBytes = readFileSync(init); writeFileSync(init, '# changed');
    expect(() => checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(fixture[0].body) })).toThrow();
    writeFileSync(init, initBytes);
    writeFileSync(join(options.sitePackages, 'json.py'), '# shadow import');
    expect(() => checkRequestCapacity(profile, { ...identity, serializedBody: JSON.stringify(fixture[0].body) })).toThrow();
    rmSync(join(options.sitePackages, 'json.py'));
    const wrong = { ...manifest, sha256: '0'.repeat(64) };
    expect(() => freezeDeepSeekRecipeCounter({ ...options, environmentManifest: wrong })).toThrow();
    } finally { rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); }
  }, 120_000);
});
