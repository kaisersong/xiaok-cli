import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatView } from '../../renderer/src/components/ChatView';

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input-placeholder" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatView artifact edit action', () => {
  it('opens HTML result artifacts directly in edit mode', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onArtifactClick = vi.fn();

    render(
      <LocaleProvider>
        <ChatView
          thread={{
            id: 'thread-artifact-edit',
            title: 'HTML artifact',
            status: 'completed',
            mode: 'work',
            createdAt: 1,
            updatedAt: 1,
            starred: false,
            gtdBucket: 'inbox',
            pinnedAt: null,
            currentTaskId: null,
            taskIds: [],
          }}
          messages={[]}
          streamingText=""
          status="completed"
          currentQuestion={null}
          result={{
            summary: '',
            artifacts: [{
              artifactId: 'artifact-report',
              kind: 'html',
              title: 'report.html',
              createdAt: 'turn-1',
              previewAvailable: true,
              filePath: '/tmp/report.html',
              mimeType: 'text/html',
            }],
          }}
          generatedFiles={[]}
          prompt=""
          onPromptChange={vi.fn()}
          onSubmit={vi.fn()}
          onAnswer={vi.fn()}
          onCancel={vi.fn()}
          canvasOpen={false}
          onToggleCanvas={vi.fn()}
          onArtifactClick={onArtifactClick}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));

    expect(onArtifactClick).toHaveBeenCalledWith(
      {
        artifactId: 'artifact-report',
        title: 'report.html',
        kind: 'html',
        filePath: '/tmp/report.html',
      },
      { startInEditMode: true },
    );

    const openButton = screen.getByRole('button', { name: /打开|Open/i });
    expect(openButton).not.toHaveTextContent(/打开|Open/i);
    expect(screen.getByTestId('artifact-actions-artifact-report')).toHaveClass('gap-1');
  });

  it('opens Markdown result artifacts directly in text edit mode', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onArtifactClick = vi.fn();

    render(
      <LocaleProvider>
        <ChatView
          thread={{
            id: 'thread-markdown-artifact',
            title: 'Markdown artifact',
            status: 'completed',
            mode: 'work',
            createdAt: 1,
            updatedAt: 1,
            starred: false,
            gtdBucket: 'inbox',
            pinnedAt: null,
            currentTaskId: null,
            taskIds: [],
          }}
          messages={[]}
          streamingText=""
          status="completed"
          currentQuestion={null}
          result={{
            summary: '',
            artifacts: [{
              artifactId: 'artifact-notes',
              kind: 'markdown',
              title: 'notes.md',
              createdAt: 'turn-1',
              previewAvailable: true,
              filePath: '/tmp/notes.md',
              mimeType: 'text/markdown',
            }],
          }}
          generatedFiles={[]}
          prompt=""
          onPromptChange={vi.fn()}
          onSubmit={vi.fn()}
          onAnswer={vi.fn()}
          onCancel={vi.fn()}
          canvasOpen={false}
          onToggleCanvas={vi.fn()}
          onArtifactClick={onArtifactClick}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit/i }));

    expect(onArtifactClick).toHaveBeenCalledWith(
      {
        artifactId: 'artifact-notes',
        title: 'notes.md',
        kind: 'markdown',
        filePath: '/tmp/notes.md',
      },
      { startInEditMode: true },
    );
    expect(screen.getByTestId('artifact-actions-artifact-notes')).toHaveClass('gap-1');
  });

  it('keeps the edit shortcut off non-editable artifacts', () => {
    Element.prototype.scrollIntoView = vi.fn();

    render(
      <LocaleProvider>
        <ChatView
          thread={{
            id: 'thread-pdf-artifact',
            title: 'PDF artifact',
            status: 'completed',
            mode: 'work',
            createdAt: 1,
            updatedAt: 1,
            starred: false,
            gtdBucket: 'inbox',
            pinnedAt: null,
            currentTaskId: null,
            taskIds: [],
          }}
          messages={[]}
          streamingText=""
          status="completed"
          currentQuestion={null}
          result={{
            summary: '',
            artifacts: [{
              artifactId: 'artifact-report-pdf',
              kind: 'pdf',
              title: 'report.pdf',
              createdAt: 'turn-1',
              previewAvailable: true,
              filePath: '/tmp/report.pdf',
              mimeType: 'application/pdf',
            }],
          }}
          generatedFiles={[]}
          prompt=""
          onPromptChange={vi.fn()}
          onSubmit={vi.fn()}
          onAnswer={vi.fn()}
          onCancel={vi.fn()}
          canvasOpen={false}
          onToggleCanvas={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('button', { name: /直接编辑|Edit/i })).toBeNull();
    const openButton = screen.getByRole('button', { name: /打开|Open/i });
    expect(openButton).toBeInTheDocument();
    expect(openButton).not.toHaveTextContent(/打开|Open/i);
  });
});
