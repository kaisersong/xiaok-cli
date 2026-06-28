import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    expect(resolveArtifactUrl({ filename: 'report.md', mimeType: 'text/markdown', projectId: 'proj-a' }))
      .toBe('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    expect(artifactDisplayName({ filename: 'report.md', mimeType: 'text/markdown' } as any)).toBe('report.md');
  });

  it('repairs malformed project artifact URLs before opening them', () => {
    expect(resolveArtifactUrl({
      projectId: 'proj-a',
      url: 'artifacts/report.md',
    })).toBe('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    expect(resolveArtifactUrl({
      projectId: 'proj-a',
      url: '/projects/proj-a/artifacts/artifacts/report.md',
    })).toBe('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    expect(resolveArtifactUrl({
      projectId: 'proj-a',
      url: '/Users/song/.kswarm/projects/proj-a/artifacts/report.md',
    })).toBe('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
  });

  it('normalizes Windows absolute project artifact paths to the KSwarm artifact route', () => {
    expect(resolveArtifactUrl({
      projectId: 'proj-win',
      path: 'C:\\Users\\song\\.kswarm\\projects\\proj-win\\artifacts\\june-global-ai-product-trends.html',
      mimeType: 'text/html',
    })).toBe('http://127.0.0.1:4400/projects/proj-win/artifacts/june-global-ai-product-trends.html');
  });

  it('shows generated time after artifact task and mime annotation', () => {
    const generatedAt = new Date(2026, 4, 18, 15, 28, 17).getTime();

    render(
      <MemoryRouter>
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
      </MemoryRouter>
    );

    expect(screen.getByText('修订故事初稿 · text/markdown · 生成 2026/05/18 15:28')).toBeInTheDocument();
  });

  it('keeps artifact annotation unchanged when generated time is missing', () => {
    render(
      <MemoryRouter>
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
      </MemoryRouter>
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
      <MemoryRouter>
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
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /report\.md/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/projects/proj-a/artifacts/report.md');
    });
    expect(await screen.findByText(/产物内容/)).toBeInTheDocument();
  });

  it('keeps report-renderer HTML readable in the scriptless project preview sandbox', async () => {
    const reportHtml = `<!doctype html>
<html>
  <head>
    <style>.fade-in-up{opacity:0}.fade-in-up.visible{opacity:1}</style>
  </head>
  <body class="report-theme">
    <h1>金蝶报告</h1>
    <p class="fade-in-up">这段正文不能因为预览禁用脚本而隐藏。</p>
    <script>document.querySelectorAll('.fade-in-up').forEach((el) => el.classList.add('visible'));</script>
  </body>
</html>`;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => reportHtml,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
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
                    { filename: 'report.html', mimeType: 'text/html', url: '/projects/proj-a/artifacts/report.html' },
                  ],
                },
              } as any,
            ]}
          />
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /report\.html/ }));

    const iframe = await screen.findByTitle('report.html');
    const srcdoc = (iframe as HTMLIFrameElement).srcdoc || iframe.getAttribute('srcdoc') || '';
    expect(srcdoc).toContain('body class="report-theme no-animations"');
    expect(srcdoc).toContain('data-xiaok-preview-fallback');
    expect(srcdoc).toContain('.fade-in-up');
    expect(srcdoc).toContain('opacity:1!important');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('opens a top-level project deliverable file that only has a name', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '# 最终报告\n\n这里是最终 Markdown。',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <LocaleProvider>
          <DeliverableView
            project={{
              id: 'proj-1779259929302',
              name: 'Claude 本月动态分析',
              status: 'delivered',
              deliverable: {
                synthesis: true,
                files: [
                  {
                    name: 'proj-1779259929302__p4-item1-report.md',
                    type: 'markdown',
                    size: 873,
                    taskId: 'proj-1779259929302__p4-item1',
                  },
                ],
              },
            } as any}
            tasks={[]}
          />
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /proj-1779259929302__p4-item1-report\.md/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/projects/proj-1779259929302/artifacts/proj-1779259929302__p4-item1-report.md');
    });
    expect(await screen.findByText(/最终报告/)).toBeInTheDocument();
  });

  it('opens a top-level workflow deliverable artifact that only has a Windows absolute path', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '<!doctype html><html><body><h1>国外AI产品动态分析</h1></body></html>',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <LocaleProvider>
          <DeliverableView
            project={{
              id: 'proj-win',
              name: '国外AI产品动态分析',
              status: 'delivered',
              deliverable: {
                summary: '已生成 HTML 报告',
                artifacts: [
                  {
                    path: 'C:\\Users\\song\\.kswarm\\projects\\proj-win\\artifacts\\june-global-ai-product-trends.html',
                    kind: 'report_html',
                    mimeType: 'text/html',
                  },
                ],
              },
            } as any}
            tasks={[]}
          />
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /june-global-ai-product-trends\.html/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/projects/proj-win/artifacts/june-global-ai-product-trends.html');
    });
    expect(await screen.findByTitle('june-global-ai-product-trends.html')).toBeInTheDocument();
  });

  it('opens workflow task artifacts with Windows absolute paths through the KSwarm route', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '<!doctype html><html><body><h1>任务报告</h1></body></html>',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <LocaleProvider>
          <DeliverableView
            project={{ id: 'proj-task-win', name: '任务报告项目', status: 'delivered' } as any}
            tasks={[
              {
                id: 'task-1',
                title: '生成 HTML 报告',
                status: 'done',
                result: {
                  summary: '已生成报告',
                  artifacts: [
                    {
                      path: 'C:\\Users\\song\\.kswarm\\projects\\proj-task-win\\artifacts\\task-report.html',
                      kind: 'report_html',
                      mimeType: 'text/html',
                    },
                  ],
                },
              } as any,
            ]}
          />
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /task-report\.html/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/projects/proj-task-win/artifacts/task-report.html');
    });
    expect(await screen.findByTitle('task-report.html')).toBeInTheDocument();
  });

  it('opens local HTML project artifacts directly in edit mode from the preview modal', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:project-artifact-edit') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '<!doctype html><html><body><h1>项目报告</h1></body></html>',
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <MemoryRouter>
          <LocaleProvider>
            <DeliverableView
              project={{
                id: 'proj-local-html',
                name: '本地 HTML 产物',
                status: 'delivered',
                deliverable: {
                  artifacts: [
                    {
                      path: '/tmp/project-report.html',
                      name: 'project-report.html',
                      mimeType: 'text/html',
                    },
                  ],
                },
              } as any}
              tasks={[]}
            />
          </LocaleProvider>
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /project-report\.html/ }));
      expect(await screen.findByTitle('project-report.html')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));

      expect(screen.getByRole('button', { name: /退出编辑|Stop editing/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/HTML 编辑|HTML edit/i)).toBeInTheDocument();
      const viewer = document.querySelector('.artifact-editable-viewer');
      expect(viewer?.parentElement).toHaveClass('artifact-preview-modal__content--editing');
    } finally {
      cleanup();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
    }
  });

  it('shows unlinked workspace artifacts while hiding generated plan files', () => {
    render(
      <MemoryRouter>
        <LocaleProvider>
          <DeliverableView
            project={{ id: 'proj-live', name: '动态工作流交付同步实时验证', status: 'delivered' } as any}
            tasks={[]}
            workspaceArtifacts={[
              { filename: 'plan-v1.md', mimeType: 'text/markdown', url: '/projects/proj-live/artifacts/plan-v1.md' },
              { filename: 'live-sync-verification.md', mimeType: 'text/markdown', url: '/projects/proj-live/artifacts/live-sync-verification.md' },
            ] as any}
          />
        </LocaleProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('项目文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /live-sync-verification\.md/ })).toBeInTheDocument();
    expect(screen.queryByText('plan-v1.md')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无交付物')).not.toBeInTheDocument();
  });
});
