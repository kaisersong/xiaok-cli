import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const { mockGetThread, mockRecoverTask, mockSubscribeTask, mockReadFileContent } = vi.hoisted(() => ({
  mockGetThread: vi.fn(),
  mockRecoverTask: vi.fn(),
  mockSubscribeTask: vi.fn(() => () => {}),
  mockReadFileContent: vi.fn(async () => ({ content: '' })),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    getThread: mockGetThread,
    recoverTask: mockRecoverTask,
    subscribeTask: mockSubscribeTask,
    readFileContent: mockReadFileContent,
  },
}));

// ChatView stub exposes the canvasOpen prop and a toggle so the test can drive
// and observe the per-session canvas state.
vi.mock('../../renderer/src/components/ChatView', () => ({
  ChatView: ({
    canvasOpen,
    onToggleCanvas,
    onArtifactClick,
    messages,
  }: {
    canvasOpen: boolean;
    onToggleCanvas: () => void;
    messages: Array<{
      role: string;
      result?: {
        artifacts?: Array<{
          artifactId: string;
          title: string;
          kind: string;
          filePath?: string;
          mimeType?: string;
          sourceTaskId?: string;
        }>;
      };
    }>;
    onArtifactClick?: (
      artifact: { artifactId: string; title: string; kind: string; filePath?: string; mimeType?: string; sourceTaskId?: string },
      options?: { startInEditMode?: boolean },
    ) => void;
  }) => (
    <div>
      <div data-testid="canvas-open">{canvasOpen ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => onToggleCanvas()}>toggle-canvas</button>
      <button
        type="button"
        onClick={() => onArtifactClick?.(
          { artifactId: 'artifact-report', title: 'report.html', kind: 'html', filePath: '/tmp/report.html' },
          { startInEditMode: true },
        )}
      >
        edit-artifact
      </button>
      {messages.flatMap((message) => message.role === 'result_card'
        ? (message.result?.artifacts ?? []).map((artifact) => (
            <button
              key={artifact.artifactId}
              type="button"
              onClick={() => onArtifactClick?.(artifact)}
            >
              {`open-${artifact.artifactId}`}
            </button>
          ))
        : [])}
    </div>
  ),
}));
// CanvasPanel is rendered only when canvasOpen is true, so its presence mirrors state.
vi.mock('../../renderer/src/components/CanvasPanel', () => ({
  CanvasPanel: ({
    initialPreviewModeRequest,
    initialPreviewFile,
    initialPreviewContent,
    expanded,
    conversationId,
    sourceTaskId,
    sourceArtifact,
  }: {
    initialPreviewModeRequest?: { id: number; startInEditMode: boolean };
    initialPreviewFile?: string | null;
    initialPreviewContent?: string;
    expanded?: boolean;
    conversationId?: string;
    sourceTaskId?: string;
    sourceArtifact?: { artifactId: string; kind?: string; mimeType?: string; title?: string; sourceTaskId?: string };
  }) => (
    <div data-testid="canvas-panel">
      <span data-testid="canvas-panel-mode">{initialPreviewModeRequest?.startInEditMode ? 'edit' : 'preview'}</span>
      <span data-testid="canvas-panel-file">{initialPreviewFile}</span>
      <span data-testid="canvas-panel-content">{initialPreviewContent}</span>
      <span data-testid="canvas-panel-expanded">{expanded ? 'expanded' : 'collapsed'}</span>
      <span data-testid="canvas-panel-conversation">{conversationId}</span>
      <span data-testid="canvas-panel-task">{sourceTaskId}</span>
      <span data-testid="canvas-panel-artifact">{sourceArtifact?.artifactId}</span>
      <span data-testid="canvas-panel-artifact-task">{sourceArtifact?.sourceTaskId}</span>
    </div>
  ),
}));
vi.mock('../../renderer/src/components/TaskPanel', () => ({
  TaskPanel: () => null,
}));
vi.mock('../../renderer/src/layouts/AppLayout', () => ({
  useSidebarCollapse: () => ({ collapsed: false, setCollapsed: () => {} }),
  AppLayout: () => null,
}));

import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatShell } from '../../renderer/src/components/ChatShell';

function thread(id: string) {
  return {
    id,
    title: id,
    status: 'idle' as const,
    mode: 'work' as const,
    createdAt: 1779000000000,
    updatedAt: 1779000000000,
    starred: false,
    gtdBucket: 'inbox' as const,
    pinnedAt: null,
    currentTaskId: null,
    taskIds: [],
  };
}

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/t/thread-A')}>go-A</button>
      <button type="button" onClick={() => navigate('/t/thread-B')}>go-B</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatShell canvas is scoped per session', () => {
  it('closes the canvas when switching to another session and reopens it when returning', async () => {
    mockGetThread.mockImplementation(async (id: string) => thread(id));

    render(
      <MemoryRouter initialEntries={['/t/thread-A']}>
        <LocaleProvider>
          <Nav />
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    // Session A loads with the canvas closed by default.
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('closed'));
    expect(screen.queryByTestId('canvas-panel')).toBeNull();

    // Open the canvas in session A.
    fireEvent.click(screen.getByRole('button', { name: 'toggle-canvas' }));
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('open'));
    expect(screen.getByTestId('canvas-panel')).toBeInTheDocument();

    // Switch to session B: the canvas must close (not bleed across conversations).
    fireEvent.click(screen.getByRole('button', { name: 'go-B' }));
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('closed'));
    expect(screen.queryByTestId('canvas-panel')).toBeNull();

    // Switch back to session A: the canvas reopens because A is where it was opened.
    fireEvent.click(screen.getByRole('button', { name: 'go-A' }));
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('open'));
    expect(screen.getByTestId('canvas-panel')).toBeInTheDocument();
  });

  it('keeps the canvas closed for a session that never opened it', async () => {
    mockGetThread.mockImplementation(async (id: string) => thread(id));

    render(
      <MemoryRouter initialEntries={['/t/thread-A']}>
        <LocaleProvider>
          <Nav />
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('closed'));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-canvas' }));
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('open'));

    // B never opened the canvas → stays closed.
    fireEvent.click(screen.getByRole('button', { name: 'go-B' }));
    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('closed'));
    expect(screen.queryByTestId('canvas-panel')).toBeNull();
  });

  it('passes artifact edit shortcut requests through to CanvasPanel', async () => {
    mockGetThread.mockImplementation(async (id: string) => ({
      ...thread(id),
      currentTaskId: 'desktop-task-7',
      taskIds: ['desktop-task-7'],
    }));
    mockReadFileContent.mockResolvedValueOnce({ content: '<html><body><h1>Report</h1></body></html>' });

    render(
      <MemoryRouter initialEntries={['/t/thread-A']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('closed'));
    fireEvent.click(screen.getByRole('button', { name: 'edit-artifact' }));

    await waitFor(() => expect(screen.getByTestId('canvas-open')).toHaveTextContent('open'));
    expect(screen.getByTestId('canvas-panel-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('canvas-panel-conversation')).toHaveTextContent('thread-A');
    expect(screen.getByTestId('canvas-panel-task')).toHaveTextContent('desktop-task-7');
    expect(screen.getByTestId('canvas-panel-artifact')).toHaveTextContent('artifact-report');
    expect(mockReadFileContent).toHaveBeenCalledWith('/tmp/report.html');
  });

  it('keeps each historical artifact bound to the task that produced it', async () => {
    mockReadFileContent.mockImplementation(async (filePath: string) => ({
      content: `<html><body>${filePath}</body></html>`,
    }));
    mockGetThread.mockResolvedValue({
      ...thread('thread-A'),
      currentTaskId: 'task-B',
      taskIds: ['task-A', 'task-B'],
    });
    mockRecoverTask.mockImplementation(async (taskId: string) => ({
      snapshot: {
        taskId,
        prompt: `prompt-${taskId}`,
        status: 'completed',
        events: [
          {
            type: 'artifact_recorded',
            artifactId: `artifact-${taskId}`,
            kind: 'html',
            label: `${taskId}.html`,
            filePath: `/tmp/${taskId}.html`,
            previewAvailable: true,
            turnId: `turn-${taskId}`,
          },
          {
            type: 'result',
            result: { summary: `done-${taskId}`, artifacts: [] },
          },
        ],
      },
    }));

    render(
      <MemoryRouter initialEntries={['/t/thread-A']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'open-artifact-task-A' }));
    await waitFor(() => expect(screen.getByTestId('canvas-panel-artifact')).toHaveTextContent('artifact-task-A'));
    expect(mockReadFileContent).toHaveBeenCalledWith('/tmp/task-A.html');
    expect(screen.getByTestId('canvas-panel-file')).toHaveTextContent('/tmp/task-A.html');
    expect(screen.getByTestId('canvas-panel-content')).toHaveTextContent('<html><body>/tmp/task-A.html</body></html>');
    expect(screen.getByTestId('canvas-panel-expanded')).toHaveTextContent('expanded');
    expect(screen.getByTestId('canvas-panel-artifact-task')).toHaveTextContent('task-A');

    fireEvent.click(screen.getByRole('button', { name: 'open-artifact-task-B' }));
    await waitFor(() => expect(screen.getByTestId('canvas-panel-artifact')).toHaveTextContent('artifact-task-B'));
    expect(screen.getByTestId('canvas-panel-artifact-task')).toHaveTextContent('task-B');
  });
});
