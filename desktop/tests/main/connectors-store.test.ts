import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorsStore } from '../../electron/connectors-store.js';

describe('ConnectorsStore', () => {
  let dataRoot: string;
  let store: ConnectorsStore;

  beforeEach(() => {
    dataRoot = join(tmpdir(), `xiaok-connectors-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataRoot, { recursive: true });
    store = new ConnectorsStore({ dataRoot });
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns defaults with status missing when no file exists', () => {
    const result = store.load();
    expect(result.status).toBe('missing');
    expect(result.config).toEqual({
      search: { provider: 'duckduckgo' },
      fetch: { provider: 'basic' },
    });
  });

  it('round-trips config with API keys in plaintext', async () => {
    await store.save({
      search: { provider: 'tavily', tavilyApiKey: 'tvly-secret' },
      fetch: { provider: 'jina', jinaApiKey: 'jina-key' },
    });

    const persistedJson = JSON.parse(readFileSync(join(dataRoot, 'connectors.json'), 'utf-8'));
    expect(persistedJson.schemaVersion).toBe(1);
    expect(persistedJson.search.provider).toBe('tavily');
    expect(persistedJson.search.tavilyApiKey).toBe('tvly-secret');
    expect(persistedJson.fetch.provider).toBe('jina');
    expect(persistedJson.fetch.jinaApiKey).toBe('jina-key');

    const reloaded = store.load();
    expect(reloaded.status).toBe('ok');
    expect(reloaded.config.search.provider).toBe('tavily');
    expect(reloaded.config.search.tavilyApiKey).toBe('tvly-secret');
    expect(reloaded.config.fetch.jinaApiKey).toBe('jina-key');
  });

  it('falls back to defaults and backs up on parse_failed', () => {
    const file = join(dataRoot, 'connectors.json');
    writeFileSync(file, '{ not valid json', 'utf-8');
    const result = store.load();
    expect(result.status).toBe('parse_failed');
    expect(result.config.search.provider).toBe('duckduckgo');
    expect(existsSync(`${file}.bak`)).toBe(true);
  });

  it('rejects unknown schema version and treats it as parse_failed', () => {
    const file = join(dataRoot, 'connectors.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 99, search: {}, fetch: {} }), 'utf-8');
    const result = store.load();
    expect(result.status).toBe('parse_failed');
    expect(existsSync(`${file}.bak`)).toBe(true);
  });

  it('overwrites previous config on save', async () => {
    await store.save({
      search: { provider: 'tavily', tavilyApiKey: 'key1' },
      fetch: { provider: 'basic' },
    });
    await store.save({
      search: { provider: 'brave', braveApiKey: 'key2' },
      fetch: { provider: 'jina', jinaApiKey: 'jina2' },
    });

    const reloaded = store.load();
    expect(reloaded.status).toBe('ok');
    expect(reloaded.config.search.provider).toBe('brave');
    expect(reloaded.config.search.braveApiKey).toBe('key2');
    expect(reloaded.config.search.tavilyApiKey).toBeUndefined();
    expect(reloaded.config.fetch.jinaApiKey).toBe('jina2');
  });
});
