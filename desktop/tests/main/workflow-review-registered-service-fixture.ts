import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createKSwarmService, computeKSwarmServiceSourceHash, type KSwarmService } from '../../electron/kswarm-service.js';

/** Simulated file/GET leaves; original Main instance/port/checkpoint are real.
 * This does not qualify persisted Hub issuer, HTTP ownership or native processes. */
export function registeredWorkflowReviewService(root: string, role: 'review' | 'agent_task') {
  const project = realpathSync(join(root, 'project'));
  const server = join(root, 'kswarm/src/server'); mkdirSync(server, { recursive: true });
  const entryPath = join(server, 'index.js'); writeFileSync(entryPath, '// Owned source fixture leaf; never spawned.\n');
  writeFileSync(join(server, 'room-workspace-protocol.json'), JSON.stringify({ component: 'kswarm', protocols: { room_workspace_v1: { contextVersion: 1, resultVersion: 1, releaseVersion: 1 } } }));
  vi.stubEnv('KSWARM_SERVER_PATH', entryPath);
  const sourceHash = computeKSwarmServiceSourceHash(entryPath);
  const scriptSource = "export const meta = { name: 'workflow' };\nphase('Review');";
  const scriptHash = createHash('sha256').update(scriptSource).digest('hex');
  const run = { id: 'workflow-run', projectId: 'project', workflowId: 'workflow', status: 'running', source: 'script_generated', spec: null, scriptSource, scriptHash,
    scriptMeta: { name: 'workflow' }, permissions: null,
    nodes: [{ id: 'node', kind: role, status: 'running', attempt: 1, assignedAgent: 'xiaok-worker', runtime: { runId: 'workflow-run', handoffId: 'handoff', participantId: 'xiaok-worker' },
      input: { script: { workflowId: 'workflow', workflowRunId: 'workflow-run', scriptHash, nodeId: 'node' } } }] };
  const requests: Array<{ port: string; path: string }> = [];
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !['4400', '4318'].includes(url.port) || url.search || url.hash || method.toUpperCase() !== 'GET')
      throw Error('workflow_review_fixture_unowned_fetch_denied');
    requests.push({ port: url.port, path: url.pathname });
    if (url.pathname === '/health') return Response.json(url.port === '4400' ? { ok: true, features: ['dynamic_workflows'], service: { entryPath, sourceHash } } : { ok: true });
    if (url.port === '4400' && url.pathname === '/agents') return Response.json({ agents: [] });
    if (url.port === '4400' && url.pathname === '/projects/project') return Response.json({ project: { id: 'project', workFolder: project }, workspace: { path: project } });
    if (url.port === '4400' && url.pathname === '/projects/project/workflows/workflow-run') return Response.json({ workflowRun: run });
    throw Error('workflow_review_fixture_unlisted_fetch_denied');
  });
  const foreignSpawn = vi.fn(() => { throw Error('workflow_review_fixture_foreign_spawn_denied'); });
  const foreignKill = vi.fn(async () => { throw Error('workflow_review_fixture_foreign_kill_denied'); });
  const service: KSwarmService = createKSwarmService({ spawnProcess: foreignSpawn as never, findPortOwner: async () => null, killStalePortOwner: foreignKill });
  return { service, run, requests, foreignSpawn, foreignKill };
}
