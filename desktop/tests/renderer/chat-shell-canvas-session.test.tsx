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
  }: {
    canvasOpen: boolean;
    onToggleCanvas: () => void;
    onArtifactClick?: (
      artifact: { artifactId: string; title: string; kind: string; filePath?: string },
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
    </div>
  ),
}));
// CanvasPanel is rendered only when canvasOpen is true, so its presence mirrors state.
vi.mock('../../renderer/src/components/CanvasPanel', () => ({
  CanvasPanel: ({
    initialPreviewModeRequest,
  }: {
    initialPreviewModeRequest?: { id: number; startInEditMode: boolean };
  }) => (
    <div data-testid="canvas-panel">
      <span data-testid="canvas-panel-mode">{initialPreviewModeRequest?.startInEditMode ? 'edit' : 'preview'}</span>
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
    mockGetThread.mockImplementation(async (id: string) => thread(id));
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
    expect(mockReadFileContent).toHaveBeenCalledWith('/tmp/report.html');
  });
});
