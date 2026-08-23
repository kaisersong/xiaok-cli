import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

/**
 * Regression for the 401 that blocked multi-agent project creation.
 *
 * The KSwarm server gates *every* desktop mutation on `x-kswarm-mutation-token`
 * (`createMutationAuthority` in `kswarm/src/core/persistence-hub.js` returns 401
 * `mutation_credential_required` without it). Desktop only sent that header on
 * `activate-and-start`, so `POST /projects` and `POST /agents` always failed with
 * `Failed to create project: 401`.
 *
 * The fake below behaves like the real server — it rejects an unauthenticated
 * mutation — which is what the previous fakes did not do, and is why the gap went
 * unnoticed.
 */
const MUTATION_TOKEN = 'desktop-token';

function tokenOf(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers ?? {});
  return headers.get('x-kswarm-mutation-token');
}

describe('KSwarm desktop mutation authority (401 regression)', () => {
  let rootDir: string;
  let seen: Array<{ path: string; method: string; token: string | null }>;

  beforeEach(() => {
    rootDir = join(tmpdir(), `kswarm-mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    seen = [];
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  /** Mirrors the server: non-GET without the token is 401. */
  function serverLikeKSwarm(): KSwarmService {
    return {
      start: async () => {},
      stop: async () => {},
      restart: async () => {},
      getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {},
      getDesktopMutationToken: () => MUTATION_TOKEN,
      request: async (path: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const token = tokenOf(init);
        seen.push({ path, method, token });

        if (method !== 'GET' && token !== MUTATION_TOKEN) {
          return new Response(
            JSON.stringify({ ok: false, error: 'mutation_credential_required' }),
            { status: 401 },
          );
        }
        if (path === '/agents' && method === 'GET') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'W1', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/agents' && method === 'POST') {
          return new Response(JSON.stringify({ agent: { id: 'team-new', name: 'Worker-3' } }), { status: 201 });
        }
        if (path === '/projects' && method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-auth-ok', name: 'Auth OK', status: 'created', createdAt: 1 },
          }), { status: 201 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    } as unknown as KSwarmService;
  }

  function services(kswarmService: KSwarmService) {
    return createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService,
      now: () => 1,
      pluginRootDir: join(rootDir, '.xiaok', 'plugins'),
    });
  }

  it('creates a project against a server that enforces the mutation token', async () => {
    const result = JSON.parse(await services(serverLikeKSwarm()).executeTool('create_project', {
      name: 'Auth OK',
      goal: '本月国外主要 AI 产品动态分析',
    }));

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ projectId: 'proj-auth-ok' });
  });

  it('sends the mutation token on every gated mutation it issues', async () => {
    await services(serverLikeKSwarm()).executeTool('create_project', {
      name: 'Auth OK',
      goal: '目标',
      memberCount: 3,
    });

    const mutations = seen.filter((entry) => entry.method !== 'GET');
    expect(mutations.length).toBeGreaterThan(0);
    const unauthenticated = mutations.filter((entry) => entry.token !== MUTATION_TOKEN);
    expect(unauthenticated, `unauthenticated mutations: ${JSON.stringify(unauthenticated)}`).toEqual([]);
  });

  it('still surfaces a real 401 rather than inventing a project id', async () => {
    const brokenClient = {
      ...serverLikeKSwarm(),
      // Simulates the pre-fix client: the token is never attached.
      request: async (path: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (path === '/agents' && method === 'GET') {
          return new Response(JSON.stringify({
            agents: [{ id: 'xiaok-po', name: 'PO', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' }],
          }));
        }
        if (method !== 'GET') {
          return new Response(JSON.stringify({ ok: false, error: 'mutation_credential_required' }), { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }));
      },
    } as unknown as KSwarmService;

    const result = JSON.parse(await services(brokenClient).executeTool('create_project', {
      name: 'Auth Missing',
      goal: '目标',
    }));

    expect(result.error).toBe('Failed to create project: 401');
    expect(result.projectId).toBeUndefined();
  });
});
