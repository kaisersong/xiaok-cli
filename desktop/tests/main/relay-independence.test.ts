import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { loadMobileRelayConfig } from '../../electron/mobile-relay.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

/**
 * The mobile relay is an optional remote-access transport. Nothing in the
 * multi-agent project path may depend on it, so an expired or entirely absent
 * relay credential must degrade to "no remote access" and never block creating or
 * running a project.
 *
 * This is worth locking down because two unrelated 401s appeared at the same time
 * — the KSwarm desktop mutation token (which really did block project creation)
 * and the relay JWT (which never did) — and conflating them would send a future
 * reader looking in the wrong place.
 */
const MUTATION_TOKEN = 'desktop-token';

describe('project creation does not depend on the mobile relay', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `relay-independence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  /** Enforces the mutation token exactly like the real KSwarm server. */
  function kswarm(): KSwarmService {
    return {
      start: async () => {},
      stop: async () => {},
      restart: async () => {},
      getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {},
      getDesktopMutationToken: () => MUTATION_TOKEN,
      request: async (path: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const token = new Headers(init?.headers ?? {}).get('x-kswarm-mutation-token');
        if (method !== 'GET' && token !== MUTATION_TOKEN) {
          return new Response(JSON.stringify({ ok: false, error: 'mutation_credential_required' }), { status: 401 });
        }
        if (path === '/agents' && method === 'GET') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'W1', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects' && method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-relay-independent', name: 'Offline Relay', status: 'created', createdAt: 1 },
          }), { status: 201 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    } as unknown as KSwarmService;
  }

  function services() {
    return createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: kswarm(),
      now: () => 1,
      pluginRootDir: join(rootDir, '.xiaok', 'plugins'),
    });
  }

  it('creates a project while the relay credential is 52 days expired', async () => {
    // The exact failure mode observed on the real machine.
    const credentialsPath = join(rootDir, 'credentials');
    const expiredExp = Math.floor(Date.now() / 1000) - 52 * 86_400;
    const payload = Buffer.from(JSON.stringify({
      sub: 'user@example.com', iss: 'intent-broker-relay', iat: 1, exp: expiredExp,
    })).toString('base64url');
    writeFileSync(credentialsPath, JSON.stringify({
      jwt: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${payload}.sig`,
      refreshToken: 'unused-by-either-side',
    }));

    const relayConfig = loadMobileRelayConfig({ env: {}, credentialsPath });
    expect(relayConfig).not.toBeNull(); // the file loads; only the server would reject it

    const result = JSON.parse(await services().executeTool('create_project', {
      name: 'Offline Relay',
      goal: '本月国外主要 AI 产品动态分析',
    }));

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ projectId: 'proj-relay-independent' });
  });

  it('creates a project when no relay credentials exist at all', async () => {
    const relayConfig = loadMobileRelayConfig({
      env: {},
      credentialsPath: join(rootDir, 'does-not-exist'),
    });
    expect(relayConfig).toBeNull(); // no relay bridge will be constructed

    const result = JSON.parse(await services().executeTool('create_project', {
      name: 'No Relay',
      goal: '目标',
    }));

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ projectId: 'proj-relay-independent' });
  });

  it('creates a project when the relay is explicitly disabled', async () => {
    expect(loadMobileRelayConfig({ env: { XIAOK_MOBILE_RELAY_DISABLED: '1' } })).toBeNull();

    const result = JSON.parse(await services().executeTool('create_project', {
      name: 'Relay Disabled',
      goal: '目标',
    }));

    expect(result).toMatchObject({ projectId: 'proj-relay-independent' });
  });

  it('keeps the relay out of the project code path entirely', async () => {
    // Structural guard: if someone later couples them, this fails loudly.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(__dirname, '..', '..', 'electron', 'desktop-services.ts'), 'utf8');
    const relayMentions = source.match(/relayJwt|mobileRelay|MobileRelay/g) ?? [];
    expect(relayMentions).toEqual([]);
  });
});
