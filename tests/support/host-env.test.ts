import { describe, expect, it } from 'vitest';
import { PROVIDER_ENV_PREFIXES, findHostLeaks, isHostLeakVariable, stripHostLeaks } from './host-env.js';
import { listProviderProfiles } from '../../src/ai/providers/registry.js';

describe('host env isolation', () => {
  it('strips leaked provider keys and keeps everything else', () => {
    const env: NodeJS.ProcessEnv = { KIMI_API_KEY: 'k', GLM_API_KEY: 'g', DEEPSEEK_API_KEY: 'd', XIAOK_MINIMAX_API_KEY: 'm', ANTHROPIC_BASE_URL: 'u', TAVILY_API_KEY: 't', HOME: '/h', PATH: '/bin', XIAOK_CONFIG_DIR: '/c' };
    expect(findHostLeaks(env)).toEqual(['ANTHROPIC_BASE_URL', 'DEEPSEEK_API_KEY', 'GLM_API_KEY', 'KIMI_API_KEY', 'TAVILY_API_KEY', 'XIAOK_MINIMAX_API_KEY']);
    expect(stripHostLeaks(env)).toHaveLength(6);
    expect(env).toEqual({ HOME: '/h', PATH: '/bin', XIAOK_CONFIG_DIR: '/c' });
    expect(stripHostLeaks(env)).toEqual([]);
  });

  it('does not treat unrelated variables as leaks', () => {
    for (const name of ['HOME', 'PATH', 'XIAOK_CONFIG_DIR', 'XIAOK_CONVERSATION_ACTIVITY', 'GH_TOKEN', 'OPENAI_MODEL']) expect(isHostLeakVariable(name)).toBe(false);
  });

  it('covers every env prefix the provider registry reads', () => {
    const registryPrefixes = new Set(listProviderProfiles().flatMap(profile => profile.envPrefixes ?? []));
    expect(registryPrefixes.size).toBeGreaterThan(0);
    for (const prefix of registryPrefixes) {
      expect(PROVIDER_ENV_PREFIXES, `registry prefix ${prefix} missing from PROVIDER_ENV_PREFIXES`).toContain(prefix);
      expect(isHostLeakVariable(`${prefix}_API_KEY`)).toBe(true);
      expect(isHostLeakVariable(`XIAOK_${prefix}_API_KEY`)).toBe(true);
    }
  });
});
