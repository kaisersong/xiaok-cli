import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { DeliverableView } from '../../renderer/src/components/projects/DeliverableView';
import { artifactDisplayName, resolveArtifactUrl } from '../../renderer/src/components/projects/artifactActions';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('project artifact actions', () => {
  it('normalizes KSwarm relative artifact URLs for desktop file-origin pages', () => {
    expect(resolveArtifactUrl({ name: 'report.md', mimeType: 'text/markdown', url: '/projects/proj-a/artifacts/report.md' }))
      .toBe('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    expect(artifactDisplayName({ filename: 'report.md', mimeType: 'text/markdown' } as any)).toBe('report.md');
  });

  it('shows generated time after artifact task and mime annotation', () => {
    const generatedAt = new Date(2026, 4, 18, 15, 28, 17).getTime();

    render(
      <LocaleProvider>
        <DeliverableView
          project={{ id: 'proj-a', name: '测试项目', status: 'active' } as any}
          tasks={[
            {
              id: 'task-1',
              title: '修订故事初稿',
              status: 'done',
              result: {
                summary: '已生成故事',
                artifacts: [
                  { filename: 'the_quiet_collaboration.md', mimeType: 'text/markdown', url: '/projects/proj-a/artifacts/the_quiet_collaboration.md', generatedAt },
                ],
              },
            } as any,
          ]}
        />
      </LocaleProvider>
    );

    expect(screen.getByText('修订故事初稿 · text/markdown · 生成 2026/05/18 15:28')).toBeInTheDocument();
  });

  it('keeps artifact annotation unchanged when generated time is missing', () => {
    render(
      <LocaleProvider>
        <DeliverableView
          project={{ id: 'proj-a', name: '测试项目', status: 'active' } as any}
          tasks={[
            {
              id: 'task-1',
              title: '修订故事初稿',
              status: 'done',
              result: {
                summary: '已生成故事',
                artifacts: [
                  { filename: 'the_quiet_collaboration.md', mimeType: 'text/markdown', url: '/projects/proj-a/artifacts/the_quiet_collaboration.md' },
                ],
              },
            } as any,
          ]}
        />
      </LocaleProvider>
    );

    expect(screen.getByText('修订故事初稿 · text/markdown')).toBeInTheDocument();
    expect(screen.queryByText(/生成 2026/)).not.toBeInTheDocument();
  });

  it('opens a deliverables artifact preview through the absolute KSwarm URL', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '# 产物内容\n\n这里是报告正文。',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocaleProvider>
        <DeliverableView
          project={{ id: 'proj-a', name: '测试项目', status: 'active' } as any}
          tasks={[
            {
              id: 'task-1',
              title: '生成报告',
              status: 'done',
              result: {
                summary: '已生成报告',
                artifacts: [
                  { filename: 'report.md', mimeType: 'text/markdown', url: '/projects/proj-a/artifacts/report.md' },
                ],
              },
            } as any,
          ]}
        />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /report\.md/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    });
    expect(await screen.findByText(/产物内容/)).toBeInTheDocument();
  });
});
