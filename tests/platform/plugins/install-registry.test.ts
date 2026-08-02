import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRY_V2_URL,
  fetchTrustedRegistryDocument,
  normalizePluginRepository,
  parseTrustedRegistry,
} from '../../../src/platform/plugins/install/registry.js';

const VALID_COMMIT = 'a'.repeat(40);
const VALID_DIGEST = 'b'.repeat(64);

function registryDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    plugins: [
      {
        name: 'demo-plugin',
        display_name: 'Demo',
        description: 'demo plugin',
        repo: 'kaisersong/kai-xiaok-plugins',
        path: 'plugins/demo-plugin',
        version: '1.2.3',
        source: { commit: VALID_COMMIT, treeSha256: VALID_DIGEST },
        install: {
          steps: [
            { kind: 'npm_ci', cwd: 'mcp-servers/demo' },
            { kind: 'npm_run', cwd: 'mcp-servers/demo', script: 'build' },
          ],
        },
        ...overrides,
      },
    ],
  };
}

describe('trusted registry v2 parsing', () => {
  it('parses a valid v2 document', () => {
    const registry = parseTrustedRegistry(registryDoc());

    expect(registry.version).toBe(2);
    expect(registry.plugins[0].name).toBe('demo-plugin');
    expect(registry.plugins[0].repo.cloneUrl).toBe('https://github.com/kaisersong/kai-xiaok-plugins');
    expect(registry.plugins[0].source.commit).toBe(VALID_COMMIT);
    expect(registry.plugins[0].install.steps).toEqual([
      { kind: 'npm_ci', cwd: 'mcp-servers/demo' },
      { kind: 'npm_run', cwd: 'mcp-servers/demo', script: 'build' },
    ]);
  });

  it('rejects legacy v1 registries with an upgrade hint instead of installing', () => {
    expect(() => parseTrustedRegistry({
      version: 1,
      repo: 'kaisersong/kai-xiaok-plugins',
      plugins: [{
        name: 'demo-plugin',
        repo: 'kaisersong/kai-xiaok-plugins',
        path: 'plugins/demo-plugin',
        version: '1.0.0',
        dependencies: { runtime: 'node', install: 'npm ci && npm run build' },
      }],
    })).toThrow(/registry v2/i);
  });

  it('never surfaces the legacy shell install field', () => {
    const registry = parseTrustedRegistry(registryDoc({
      dependencies: { runtime: 'node', install: 'rm -rf /' },
    }));

    expect(JSON.stringify(registry)).not.toContain('rm -rf');
  });

  it('rejects mutable refs in source.commit', () => {
    for (const commit of ['main', 'HEAD', 'refs/heads/main', 'a'.repeat(39), `${'a'.repeat(39)}Z`, 'A'.repeat(40)]) {
      expect(() => parseTrustedRegistry(registryDoc({ source: { commit, treeSha256: VALID_DIGEST } })))
        .toThrow(/commit/i);
    }
  });

  it('rejects malformed tree digests', () => {
    for (const treeSha256 of ['', 'b'.repeat(63), 'B'.repeat(64), 'not-a-digest']) {
      expect(() => parseTrustedRegistry(registryDoc({ source: { commit: VALID_COMMIT, treeSha256 } })))
        .toThrow(/treeSha256/i);
    }
  });

  it('rejects unsafe repository slugs', () => {
    for (const repo of [
      'kaisersong',
      'kaisersong/kai/extra',
      '../kaisersong/plugins',
      'kaisersong/..',
      '-flag/plugins',
      'kaisersong/-flag',
      'git@github.com:kaisersong/plugins.git',
      'https://evil.example.com/kaisersong/plugins',
      'kaisersong/plug ins',
    ]) {
      expect(() => normalizePluginRepository(repo)).toThrow(/repo/i);
      expect(() => parseTrustedRegistry(registryDoc({ repo }))).toThrow(/repo/i);
    }
  });

  it('rejects plugin names that are unsafe as directory names', () => {
    for (const name of ['..', '.', 'Demo', 'demo/plugin', 'demo\\plugin', '-demo', '', 'demo plugin', '.active']) {
      expect(() => parseTrustedRegistry(registryDoc({ name }))).toThrow(/name/i);
    }
  });

  it('rejects plugin paths that escape the repository', () => {
    for (const path of ['../secrets', '/etc', 'plugins/../../etc', 'plugins/demo/', '', '-plugins', 'plugins\\demo']) {
      expect(() => parseTrustedRegistry(registryDoc({ path }))).toThrow(/path/i);
    }
  });

  it('rejects duplicate plugin names', () => {
    const doc = registryDoc() as { plugins: unknown[] };
    doc.plugins.push(JSON.parse(JSON.stringify(doc.plugins[0])));

    expect(() => parseTrustedRegistry(doc)).toThrow(/duplicate/i);
  });

  it('rejects unknown or shell-shaped install steps', () => {
    expect(() => parseTrustedRegistry(registryDoc({ install: { steps: [{ kind: 'shell', command: 'rm -rf /' }] } })))
      .toThrow(/step/i);
    expect(() => parseTrustedRegistry(registryDoc({ install: { steps: [{ kind: 'npm_run', script: 'build; rm -rf /' }] } })))
      .toThrow(/script/i);
    expect(() => parseTrustedRegistry(registryDoc({ install: { steps: [{ kind: 'npm_ci', cwd: '../../etc' }] } })))
      .toThrow(/cwd/i);
    expect(() => parseTrustedRegistry(registryDoc({
      install: { steps: [{ kind: 'python_requirements', file: '/etc/requirements.txt' }] },
    }))).toThrow(/file/i);
    expect(() => parseTrustedRegistry(registryDoc({ install: { steps: [{ kind: 'external' }] } })))
      .toThrow(/serverNames/i);
  });

  it('defaults step cwd to the plugin root and accepts external server bindings', () => {
    const registry = parseTrustedRegistry(registryDoc({
      install: {
        steps: [
          { kind: 'npm_ci' },
          { kind: 'external', serverNames: ['slide-renderer'], reason: 'requires system python' },
        ],
      },
    }));

    expect(registry.plugins[0].install.steps[0]).toEqual({ kind: 'npm_ci', cwd: '.' });
    expect(registry.plugins[0].install.steps[1]).toEqual({
      kind: 'external',
      cwd: '.',
      serverNames: ['slide-renderer'],
      reason: 'requires system python',
    });
  });

  it('treats a missing install block as no steps', () => {
    const doc = registryDoc();
    delete (doc.plugins as Array<Record<string, unknown>>)[0].install;

    expect(parseTrustedRegistry(doc).plugins[0].install.steps).toEqual([]);
  });
});

describe('trusted registry download', () => {
  const okResponse = (body: string) => async (url: string) => ({
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: Buffer.from(body, 'utf8'),
    url,
  });

  it('points at the standalone v2 registry document', () => {
    expect(DEFAULT_REGISTRY_V2_URL).toContain('registry-v2.json');
    expect(DEFAULT_REGISTRY_V2_URL.startsWith('https://')).toBe(true);
    expect(new URL(DEFAULT_REGISTRY_V2_URL).host).toBe('raw.githubusercontent.com');
    expect(DEFAULT_REGISTRY_V2_URL).toContain('kaisersong/kai-xiaok-plugins');
    // registry.json must stay a separate document so older CLIs keep working.
    expect(DEFAULT_REGISTRY_V2_URL.endsWith('/registry.json')).toBe(false);
  });

  it('fails closed when the v2 registry is not published yet', async () => {
    await expect(fetchTrustedRegistryDocument({
      request: async (url) => ({ statusCode: 404, headers: {}, body: Buffer.from('Not Found'), url }),
    })).rejects.toThrow(/404/);

    await expect(fetchTrustedRegistryDocument({
      request: okResponse(JSON.stringify({ version: 1, plugins: [] })),
    })).rejects.toThrow(/registry v2/i);
  });

  it('requires explicit trust for a custom registry url', async () => {
    await expect(fetchTrustedRegistryDocument({
      registryUrl: 'https://example.com/registry-v2.json',
      trustRegistry: false,
      request: okResponse(JSON.stringify(registryDoc())),
    })).rejects.toThrow(/--trust-registry/);
  });

  it('rejects non-https registry urls even when trusted', async () => {
    await expect(fetchTrustedRegistryDocument({
      registryUrl: 'http://example.com/registry-v2.json',
      trustRegistry: true,
      request: okResponse(JSON.stringify(registryDoc())),
    })).rejects.toThrow(/https/i);
    await expect(fetchTrustedRegistryDocument({
      registryUrl: 'file:///etc/registry-v2.json',
      trustRegistry: true,
      request: okResponse(JSON.stringify(registryDoc())),
    })).rejects.toThrow(/https/i);
  });

  it('rejects the default registry host being redirected to another host', async () => {
    const request = async (url: string) => {
      if (url === DEFAULT_REGISTRY_V2_URL) {
        return {
          statusCode: 302,
          headers: { location: 'https://evil.example.com/registry-v2.json' },
          body: Buffer.alloc(0),
          url,
        };
      }
      throw new Error(`unexpected fetch of ${url}`);
    };

    await expect(fetchTrustedRegistryDocument({ request })).rejects.toThrow(/redirect/i);
  });

  it('rejects oversized registry documents', async () => {
    await expect(fetchTrustedRegistryDocument({
      request: okResponse(' '.repeat(3 * 1024 * 1024)),
      maxBytes: 2 * 1024 * 1024,
    })).rejects.toThrow(/too large|2 MiB/i);
  });

  it('parses the fetched default registry', async () => {
    const registry = await fetchTrustedRegistryDocument({
      request: okResponse(JSON.stringify(registryDoc())),
    });

    expect(registry.plugins[0].name).toBe('demo-plugin');
  });
});
