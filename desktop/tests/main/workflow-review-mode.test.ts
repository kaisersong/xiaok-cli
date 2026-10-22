// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { sealAndDrainKSwarmServiceInstance, type KSwarmService } from '../../electron/kswarm-service.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { registeredWorkflowReviewService } from './workflow-review-registered-service-fixture.js';
const roots: string[] = [], services: ReturnType<typeof createDesktopServices>[] = [], registered: KSwarmService[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const service of services.splice(0)) for (const close of [() => service.closeTaskSourceWritersForMigration(), () => service.disposeMultiAgent()]) try { await close(); } catch (error) { errors.push(error); }
  for (const service of registered.splice(0)) try { await sealAndDrainKSwarmServiceInstance(service); } catch (error) { errors.push(error); }
  for (const restore of [() => vi.restoreAllMocks(), () => vi.unstubAllGlobals(), () => vi.unstubAllEnvs()]) try { restore(); } catch (error) { errors.push(error); }
  if (!errors.length) for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (errors.length) throw new AggregateError(errors, 'workflow_review_fixture_cleanup_unknown; retainedRoots=' + JSON.stringify(roots));
});
function setup(role: 'review' | 'agent_task') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-reading-mode-'))); roots.push(root);
  const project = join(root, 'project'), artifacts = join(project, 'artifacts'); mkdirSync(artifacts, { recursive: true });
  const file = join(artifacts, 'reference.txt'); writeFileSync(file, 'ORIGINAL');
  const config = join(root, 'config'); mkdirSync(config); vi.stubEnv('XIAOK_CONFIG_DIR', config); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
  writeFileSync(join(config, 'config.json'), JSON.stringify({ schemaVersion: 1, defaultModel: 'custom', models: { custom: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture', model: 'fixture-model' } }, channels: {} }));
  const transport = registeredWorkflowReviewService(root, role); registered.push(transport.service);
  const handoff = { projectId: 'project', workflowRunId: 'workflow-run', workflowId: 'workflow', nodeId: 'node', nodeKind: role, nodeTitle: role, attempt: 1, handoffId: 'handoff',
    project: { id: 'project', name: 'Project', goal: 'read reference', workFolder: project },
    input: { prompt: 'Read the reference', upstreamOutputs: { worker: { nodeId: 'worker', summary: 'reference produced', artifactPaths: [file] } }, permissions: { allowWrite: true, nativeReadonlyOnly: false } } };
  const create = (kswarmService = transport.service) => { const service = createDesktopServices({ dataRoot: join(root, 'data'), kswarmService }); services.push(service); return service; };
  return { root, file, transport, handoff, create };
}
it.each([{ role: 'review', operation: 'write' }, { role: 'review', operation: 'edit' }, { role: 'agent_task', operation: 'write' }] as const)('actual workflow $role reads reference and preserves its intended $operation behavior', async ({ role, operation }) => {
  const f = setup(role); let calls = 0, actualRead = '';
  vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
    if (calls === 1) { const read = messages.flatMap(m => m.content).find(c => c.type === 'tool_result'); actualRead = read?.type === 'tool_result' ? read.content : ''; }
    if (++calls === 1) yield { type: 'tool_use', id: 'read', name: 'read', input: { file_path: f.file } };
    else if (calls === 2) yield { type: 'tool_use', id: 'writing', name: operation, input: operation === 'write' ? { file_path: f.file, content: 'UPDATED' } : { file_path: f.file, old_string: 'ORIGINAL', new_string: 'UPDATED' } };
    else yield { type: 'text', delta: JSON.stringify(role === 'review' ? { reviewDecision: { status: 'passed', reason: 'reference read', evidenceRefs: [f.file] }, output: { summary: 'reference checked' } } : { output: { summary: 'ordinary worker wrote its deliverable', artifacts: [{ path: f.file, kind: 'text' }] } }) };
    yield { type: 'done' };
  });
  const result = await f.create().runKSwarmWorkflowNode({ handoff: f.handoff });
  expect(calls).toBe(3); expect(actualRead).toContain('ORIGINAL'); expect(readFileSync(f.file, 'utf8')).toBe(role === 'review' ? 'ORIGINAL' : 'UPDATED');
  if (role === 'review') expect(result.reviewDecision).toMatchObject({ status: 'passed', reason: 'reference read' }); else expect(result.output?.summary).toContain('ordinary worker');
  expect(f.transport.requests).toContainEqual({ port: '4400', path: '/projects/project/workflows/workflow-run' });
  expect(f.transport.foreignSpawn).not.toHaveBeenCalled(); expect(f.transport.foreignKill).not.toHaveBeenCalled();
});
it.each(['fake', 'copy', 'replaced-request', 'closed', 'wrong-kind', 'wrong-handoff'] as const)('actual workflow rejects %s before allocating provider or changing its file', async mode => {
  const f = setup('review'), adapter = vi.spyOn(OpenAIAdapter.prototype, 'stream');
  let service = f.transport.service, code = 'workflow_stored_restrictions_denied';
  if (mode === 'fake') { service = { request: async () => Response.json({ agents: [] }), getDesktopMutationToken: () => 'fixture', getStatus: () => ({ running: true }), onStatusChange: () => () => {} } as never; code = 'kswarm_workflow_read_instance_unknown'; }
  if (mode === 'copy') { service = { ...service }; code = 'kswarm_workflow_read_instance_unknown'; }
  if (mode === 'replaced-request') { service.request = async () => Response.json({}); code = 'kswarm_workflow_read_instance_changed'; }
  if (mode === 'closed') await sealAndDrainKSwarmServiceInstance(service);
  if (mode === 'wrong-kind') f.transport.run.nodes[0]!.kind = 'agent_task';
  if (mode === 'wrong-handoff') f.transport.run.nodes[0]!.runtime.handoffId = 'other-handoff';
  await expect(f.create(service).runKSwarmWorkflowNode({ handoff: f.handoff })).rejects.toThrow(code);
  expect(adapter).not.toHaveBeenCalled(); expect(readFileSync(f.file, 'utf8')).toBe('ORIGINAL');
  expect(f.transport.foreignSpawn).not.toHaveBeenCalled(); expect(f.transport.foreignKill).not.toHaveBeenCalled();
});
