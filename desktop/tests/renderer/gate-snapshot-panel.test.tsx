import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GateSnapshotPanel } from '../../renderer/src/components/projects/GateSnapshotPanel';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).xiaokDesktop;
});

function renderPanel(projectId = 'proj-1') {
  render(
    <LocaleProvider>
      <GateSnapshotPanel projectId={projectId} />
    </LocaleProvider>,
  );
}

function stubDesktop({
  getHandler,
  postHandler,
}: {
  getHandler: (path: string) => Promise<unknown>;
  postHandler?: (path: string, body: unknown) => Promise<unknown>;
}) {
  Object.defineProperty(window, 'xiaokDesktop', {
    configurable: true,
    value: {
      kswarmProxyGet: vi.fn().mockImplementation(getHandler),
      kswarmProxyPost: vi.fn().mockImplementation(postHandler ?? (async () => ({ ok: true }))),
    },
  });
}

describe('GateSnapshotPanel', () => {
  it('renders nothing while loading and nothing if the snapshot fetch fails', async () => {
    stubDesktop({ getHandler: async () => ({ ok: false, error: 'project_not_found' }) });
    renderPanel();
    await waitFor(() => {
      expect(screen.queryByText(/./)).toBeNull();
    });
  });

  it('shows the blocked state and open condition count when a blocking condition is open', async () => {
    stubDesktop({
      getHandler: async () => ({
        ok: true,
        snapshot: {
          projectId: 'proj-1',
          phase: 'active',
          counts: {},
          conditionSummaries: [
            { conditionId: 'c1', severity: 'high', status: 'open', blocking: true },
          ],
          artifacts: [],
          userActions: [],
        },
      }),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('验证阻断')).toBeTruthy();
    });
    expect(screen.getByText('1 个待处理条件')).toBeTruthy();
  });

  it('shows an approve button when userActions includes approve_final_deliverable, and calls the approval endpoint on click', async () => {
    const postSpy = vi.fn().mockResolvedValue({ ok: true, finalDeliverable: { status: 'approved' } });
    stubDesktop({
      getHandler: async () => ({
        ok: true,
        snapshot: {
          projectId: 'proj-1',
          phase: 'active',
          counts: {},
          conditionSummaries: [],
          artifacts: [],
          userActions: [{ action: 'approve_final_deliverable', deliverableId: 'fd-1' }],
        },
      }),
      postHandler: postSpy,
    });
    renderPanel();

    const button = await waitFor(() => screen.getByRole('button'));
    fireEvent.click(button);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/projects/proj-1/final-deliverables/fd-1/approve',
        expect.objectContaining({ approvalIdempotencyKey: expect.any(String) }),
      );
    });
  });

  it('shows the completed state when there are no blocking conditions and no pending user actions', async () => {
    stubDesktop({
      getHandler: async () => ({
        ok: true,
        snapshot: {
          projectId: 'proj-1',
          phase: 'delivered',
          counts: {},
          conditionSummaries: [],
          artifacts: [],
          userActions: [],
        },
      }),
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('任务执行完成')).toBeTruthy();
    });
  });
});
