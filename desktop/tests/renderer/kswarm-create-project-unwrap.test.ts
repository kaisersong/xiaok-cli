import { createKSwarmSemanticService } from '../../electron/kswarm-semantic-service.js';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKSwarmClient } from '../../renderer/src/hooks/useKSwarmClient';

describe('useKSwarmClient.createProject envelope unwrap', () => {
  let createKSwarmProjectMock: ReturnType<typeof vi.fn>;
  let kswarmProxyGetMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kswarmProxyGetMock = vi.fn().mockResolvedValue({ projects: [] });
    createKSwarmProjectMock = vi.fn().mockResolvedValue({ projects: [] });
    enqueueMock = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).window.xiaokDesktop = {
      listPrinciples: vi.fn().mockResolvedValue([]),
      kswarmStartProjectPlanning: enqueueMock,
      createKSwarmProject: createKSwarmProjectMock,
      kswarmProxyGet: kswarmProxyGetMock,
      kswarmProxyDelete: vi.fn().mockResolvedValue(true),
      kswarmStreamSubscribe: vi.fn().mockResolvedValue({ ok: true }),
      kswarmStreamUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
      onKSwarmConnectionStatus: vi.fn().mockReturnValue(() => {}),
      onKSwarmWsEvent: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (globalThis as any).window.xiaokDesktop;
  });

  it('unwraps response.project and enqueues planning bootstrap with the project id', async () => {
    createKSwarmProjectMock.mockResolvedValue({
      ok: true,
      project: { id: 'proj-xyz', name: 'Demo', status: 'created', createdAt: 1 },
      preparation: {},
      planningStart: {},
    });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown;
    await act(async () => {
      created = await result.current.createProject({
        name: 'Demo',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: ['xiaok-worker'],
      } as any);
    });

    expect(created).toMatchObject({ id: 'proj-xyz', name: 'Demo' });
    expect(createKSwarmProjectMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Demo',
      goal: 'Build something',
      autoStartPlanning: false,
    }));
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-xyz',
      projectName: 'Demo',
      poAgent: 'xiaok-po',
    }));
  });

  it('enqueues the canonical bare project returned by the actual main semantic service', async () => {
    const service = createKSwarmSemanticService({
      kswarmService: { getDesktopMutationToken: () => 'fixture-token', request: async () => Response.json({ ok: true,
        project: { id: 'proj-main', name: 'Canonical', goal: 'Build something', status: 'created', createdAt: 1,
          poAgent: 'canonical-po', members: ['canonical-worker'], requestedStartPolicy: 'activate_and_dispatch_after_plan' } }) },
      teamService: {} as never,
    });
    createKSwarmProjectMock.mockImplementation(input => service.createKSwarmProject(input));
    const { result } = renderHook(() => useKSwarmClient());
    let created: unknown;
    await act(async () => { created = await result.current.createProject({ name: 'Demo', goal: 'Build something', poAgent: 'requested-po' }); });
    expect(created).toMatchObject({ id: 'proj-main' });
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-main', poAgent: 'canonical-po', members: ['canonical-worker'], startPolicy: 'activate_and_dispatch_after_plan' }));
  });

  it('preserves an explicit plan-only policy in the actual queue request', async () => {
    createKSwarmProjectMock.mockResolvedValue({ id: 'proj-plan-only', name: 'Plan', poAgent: 'xiaok-po', members: [], requestedStartPolicy: 'plan_only' });
    const { result } = renderHook(() => useKSwarmClient());
    await act(async () => { await result.current.createProject({ name: 'Plan', goal: 'Only plan', poAgent: 'xiaok-po', startPolicy: 'plan_only' }); });
    expect(createKSwarmProjectMock).toHaveBeenCalledWith(expect.objectContaining({ startPolicy: 'plan_only' }));
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ startPolicy: 'plan_only' }));
  });

  it('returns null and does not enqueue planning when the project id is missing', async () => {
    createKSwarmProjectMock.mockResolvedValue({ ok: true, project: { name: 'NoId', status: 'created' } });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown = 'sentinel';
    await act(async () => {
      created = await result.current.createProject({
        name: 'NoId',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: [],
      } as any);
    });

    expect(created).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('still returns the project but logs when planning enqueue is rejected', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    enqueueMock.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    createKSwarmProjectMock.mockResolvedValue({
      ok: true,
      project: { id: 'proj-rej', name: 'Rej', status: 'created', createdAt: 1 },
    });

    const { result } = renderHook(() => useKSwarmClient());

    let created: unknown;
    await act(async () => {
      created = await result.current.createProject({
        name: 'Rej',
        goal: 'Build something',
        poAgent: 'xiaok-po',
        members: [],
      } as any);
    });

    expect(created).toMatchObject({ id: 'proj-rej' });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[createProject] Planning bootstrap enqueue rejected',
        expect.objectContaining({ ok: false }),
      );
    });
  });
});
