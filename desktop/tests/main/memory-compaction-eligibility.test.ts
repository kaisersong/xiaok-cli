// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../../../src/types.js';
import { isCompactionModel, memorySettingsSnapshot } from '../../../src/ai/memory/configuration.js';
import { resolveMemoryCompactionLLM } from '../../../src/ai/memory/compaction-model.js';
import { MemorySettingsService } from '../../electron/memory-settings-service.js';

function fixture(capabilities?: string[]): Config {
  return { ...structuredClone(DEFAULT_CONFIG), defaultModelId: 'alias', providers: {
    fixture: { type: 'custom', protocol: 'openai_legacy' },
  }, models: { alias: { provider: 'fixture', model: 'custom-model', label: 'Alias', capabilities } },
  memory: { compaction: { modelId: 'alias' } } };
}
describe('compaction requires explicit text generation evidence', () => {
  it.each([undefined, ['tools'], ['image_in'], ['thinking']])('does not infer capability from protocol or %j', caps => {
    const c = fixture(caps); c.models.alias.purpose = 'generation';
    expect(isCompactionModel(c, 'alias')).toBe(false);
  });
  it.each(['embedding', 'embeddings', 'text_embedding', 'EMBEDDING_MODEL', 'reranker', 'rerank', 're-ranking', 'classification', 'classifier', 'decision', 'ASR', 'speech-to-text', 'tts', 'text_to_speech'])('rejects non-generation capability alias %s even with a text claim', cap => {
    expect(isCompactionModel(fixture(['text_generation', cap]), 'alias')).toBe(false);
  });
  it.each(['image_generation', 'audio_generation'])('rejects pure output %s without explicit text output', cap => {
    expect(isCompactionModel(fixture([cap, 'tools']), 'alias')).toBe(false);
  });
  it('allows declared text output for a multimodal LLM without claiming quality or inventing context', () => {
    const c = fixture(['text_generation', 'image_in', 'image_generation']);
    expect(isCompactionModel(c, 'alias')).toBe(true);
    expect(memorySettingsSnapshot(c).compactionModels[0]).toMatchObject({ eligible: true, source: 'config_declared', contextLimit: null, quality: 'not_evaluated' });
  });
  it('catalog capability follows exact wire model, not alias ID or custom provider name', () => {
    const c = fixture(); c.providers = { glm: { type: 'first_party', protocol: 'openai_legacy' } };
    c.models.alias = { provider: 'glm', model: 'glm-5.3-flash', label: 'Alias' };
    expect(isCompactionModel(c, 'alias')).toBe(true);
    expect(memorySettingsSnapshot(c).compactionModels[0]).toMatchObject({ source: 'provider_catalog', contextLimit: 1_048_576, quality: 'not_evaluated' });
    c.providers.glm.type = 'custom'; expect(isCompactionModel(c, 'alias')).toBe(false);
    c.providers.glm.type = 'first_party'; c.models.alias.model = 'unknown-wire'; expect(isCompactionModel(c, 'alias')).toBe(false);
  });
  it('retains an invalid saved model and exposes recoverable metadata, without falling back', () => {
    const c = fixture();
    expect(memorySettingsSnapshot(c)).toMatchObject({ compactionModelId: 'alias', resolvedCompactionModelId: null, warning: 'invalid_model',
      compactionModels: [{ id: 'alias', eligible: false, reason: 'unknown_capability', source: null, contextLimit: null }] });
    expect(resolveMemoryCompactionLLM(c, {} as never)).toBeUndefined();
    expect(c.memory?.compaction?.modelId).toBe('alias');
  });
  it('backend rejects bypasses including default main model, and never creates an adapter', async () => {
    const c = fixture(); const save = vi.fn(); const createLLM = vi.fn();
    const service = new MemorySettingsService({ load: async () => c, save,
      store: { save: async () => {}, listRelevant: async () => [], setLLMFn: () => {}, compact: async request => { await request.prepare?.(new AbortController().signal); return {status:'unchanged',l1:0,l2:0,l3:0}; } }, createLLM });
    await expect(service.setCompactionModel('alias', { requestSource: 'user' })).rejects.toThrow('invalid_compaction_model');
    await expect(service.setCompactionModel(null, { requestSource: 'user' })).rejects.toThrow('invalid_compaction_model');
    await expect(service.compact({ requestSource: 'user' })).rejects.toThrow('invalid_compaction_model');
    expect(save).not.toHaveBeenCalled(); expect(createLLM).not.toHaveBeenCalled();
    c.memory!.compaction!.modelId = null;
    await expect(service.compact({ requestSource: 'user' })).rejects.toThrow('invalid_compaction_model');
    expect(resolveMemoryCompactionLLM(c, {} as never)).toBeUndefined();
  });
});

it('revalidates capability before subsequent calls using a retained compaction adapter', async () => {
  const c = fixture(['text_generation']); const llm = vi.fn(async () => '{}');
  let retained: ((prompt: string) => Promise<string>) | undefined;
  const service = new MemorySettingsService({ load: async () => c, save: async () => {},
    store: { save: async () => {}, listRelevant: async () => [], setLLMFn: fn => { retained = fn; },
      compact: async request => { await request.prepare?.(new AbortController().signal); return {status:'completed',l1:0,l2:0,l3:0}; } }, createLLM: () => llm });
  await service.compact({ requestSource: 'user' });
  c.models.alias.capabilities = ['TTS'];
  await expect(retained!('synthetic')).rejects.toThrow('invalid_compaction_model');
  expect(llm).not.toHaveBeenCalled();
});

it('uses explicit output declarations, respecting negative output and non-generation purpose', () => {
  const c = fixture(); c.models.alias.outputModalities = ['text', 'image'];
  expect(isCompactionModel(c, 'alias')).toBe(true);
  c.models.alias.capabilities = ['text_generation']; c.models.alias.outputModalities = ['image'];
  expect(isCompactionModel(c, 'alias')).toBe(false);
  c.models.alias.outputModalities = ['text']; c.models.alias.purpose = 'decision';
  expect(isCompactionModel(c, 'alias')).toBe(false);
});
