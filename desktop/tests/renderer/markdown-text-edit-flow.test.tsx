import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const { mockSaveFile } = vi.hoisted(() => ({
  mockSaveFile: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    saveFile: mockSaveFile,
  }),
}));

import { CanvasPreview } from '../../renderer/src/components/CanvasPreview';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CanvasPreview Markdown text edit flow', () => {
  it('starts Markdown artifacts in text edit mode and saves through text-edit purpose', async () => {
    const onRefresh = vi.fn();

    render(
      <LocaleProvider>
        <CanvasPreview
          filePath="/tmp/xiaok/tasks/notes.md"
          content={'# Old title\n\nBody'}
          modeRequest={{ id: 1, startInEditMode: true }}
          onRefresh={onRefresh}
        />
      </LocaleProvider>,
    );

    const editor = screen.getByLabelText(/Markdown 内容|Markdown content/i) as HTMLTextAreaElement;
    expect(editor.value).toBe('# Old title\n\nBody');

    fireEvent.change(editor, { target: { value: '# New title\n\nBody' } });
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    expect(mockSaveFile).toHaveBeenCalledWith({
      filePath: '/tmp/xiaok/tasks/notes.md',
      content: '# New title\n\nBody',
      purpose: 'text-edit',
    });
    expect(screen.getByText(/已保存|Saved/i)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps immutable Markdown previews read-only even when an edit-mode request is present', () => {
    render(
      <LocaleProvider>
        <CanvasPreview
          filePath="/tmp/xiaok/tasks/immutable-revision.md"
          content={'# Immutable revision\n\nBody'}
          interactionMode="read_only"
          modeRequest={{ id: 2, startInEditMode: true }}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('button', { name: /直接编辑|Direct edit/i })).toBeNull();
    expect(screen.queryByLabelText(/Markdown 内容|Markdown content/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /保存|Save/i })).toBeNull();
    expect(screen.getByText('Immutable revision')).toBeInTheDocument();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });
});
