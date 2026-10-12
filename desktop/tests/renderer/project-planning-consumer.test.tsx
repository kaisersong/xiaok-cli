import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';
import { createPreloadApi, INVOKE_CHANNEL_BY_KEY } from '../../electron/preload-api';
import { registerProjectPlanningIpc } from '../../electron/project-planning-typed-ipc';
import { createKSwarmSemanticService } from '../../electron/kswarm-semantic-service';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';
const project = { id: 'owned-project', name: 'Owned', goal: 'ordinary plan', status: 'created', createdAt: 1, poAgent: 'xiaok-po', members: [], requestedStartPolicy: 'plan_only' };
afterEach(() => { cleanup(); delete (window as unknown as { xiaokDesktop?: unknown }).xiaokDesktop; _resetDesktopApiCache(); vi.restoreAllMocks(); });
it.each(['false', 'reject'] as const)('actual create UI -> semantic project -> planning %s -> refresh retains created project without replay', async mode => {
  resetIpcSchemaRegistryForTests(); _resetDesktopApiCache();
  let created = false, creations = 0, refreshAfterCreate = 0, enqueueCalls = 0;
  const planningInputs: unknown[] = [];
  const semantic = createKSwarmSemanticService({ kswarmService: { getDesktopMutationToken: () => 'fixture-only', request: async () => {
    created = true; creations++; return Response.json({ ok: true, project });
  } }, teamService: {} as never });
  const handlers = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const registrar = new ShutdownAwareIpcMain({ handle: (name, callback) => handlers.set(name, callback) }, gate);
  // Actual transport/witness/DTO owner; this queue port never dispatches work.
  registerProjectPlanningIpc(registrar, (_event, input) => {
    enqueueCalls++; planningInputs.push(input);
    return mode === 'reject' ? Promise.reject(Error('project_planning_failed')) : Promise.resolve({ ok: false, error: 'project_planning_failed' });
  });
  const transport = { invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === INVOKE_CHANNEL_BY_KEY.createKSwarmProject) return semantic.createKSwarmProject(args[0] as Record<string, unknown>);
    const callback = handlers.get(channel); if (callback) return callback({} as never, ...args);
    if (channel === 'desktop:kswarm:proxy:get') { if (created && args[0] === '/projects') refreshAfterCreate++; return args[0] === '/agents' ? { agents: [] } : args[0] === '/participants' ? { participants: [] } : { projects: created ? [project] : [] }; }
    if (channel === 'desktop:listPrinciples') return [];
    return { ok: true };
  }, on() {}, off() {}, removeListener() {} };
  window.xiaokDesktop = createPreloadApi(transport as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  function View() {
    const client = useKSwarmClient(), [reply, setReply] = useState<string>('');
    return <><button onClick={() => { void client.createProject({ name: 'Owned', goal: 'ordinary plan', poAgent: 'xiaok-po', members: [], startPolicy: 'plan_only' }).then(value => setReply(value?.id ?? 'missing')); }}>create ordinary project</button>
      <output data-testid="created">{reply}</output><output data-testid="project-list">{client.projects.map(value => value.id).join(',')}</output></>;
  }
  await act(async () => { render(<View />); });
  fireEvent.click(screen.getByRole('button', { name: 'create ordinary project' }));
  await waitFor(() => expect(screen.getByTestId('created').textContent).toBe(project.id), { timeout: 1500 });
  await waitFor(() => expect(screen.getByTestId('project-list').textContent).toContain(project.id), { timeout: 1500 });
  expect(creations).toBe(1); expect(enqueueCalls).toBe(1); expect(refreshAfterCreate).toBeGreaterThan(0);
  expect(planningInputs).toEqual([expect.objectContaining({ projectId: project.id, projectName: project.name, goal: 'ordinary plan', requirements: '', planningGuidance: expect.any(String), poAgent: 'xiaok-po', members: [], startPolicy: 'plan_only' })]);
  expect(error).toHaveBeenCalledWith(mode === 'false' ? '[createProject] Planning bootstrap enqueue rejected' : '[createProject] Failed to enqueue planning bootstrap', expect.anything());
  expect(gate.outstanding).toBe(0);
});
