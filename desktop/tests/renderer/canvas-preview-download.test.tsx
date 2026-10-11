import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasPreview } from '../../renderer/src/components/CanvasPreview';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const { showSaveDialog, saveFile } = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({ showSaveDialog, saveFile }),
}));
vi.mock('../../renderer/src/components/ArtifactEditableViewer', () => ({
  ArtifactEditableViewer: () => <div />,
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'mock-worker' }));

beforeEach(() => {
  showSaveDialog.mockReset();
  saveFile.mockReset();
});
afterEach(cleanup);

describe('CanvasPreview download', () => {
  it.each([
    ['/tmp/青创赛参考报告.html', '青创赛参考报告.html'],
    ['D:\\Reports\\报告.html', '报告.html'],
    ['/tmp/report.md', 'report.md'],
    ['/tmp/report.svg', 'report.svg'],
    ['/tmp/report.pdf', 'report.pdf'],
  ])('keeps the output filename and content for %s', async (filePath, filename) => {
    const content = 'original artifact content';
    const destination = `/exports/${filename}`;
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    saveFile.mockResolvedValue({ success: true });
    render(<LocaleProvider><CanvasPreview filePath={filePath} content={content} interactionMode="read_only" /></LocaleProvider>);

    fireEvent.click(screen.getByTitle(/下载到本地|Download/i));

    await waitFor(() => expect(saveFile).toHaveBeenCalledWith({ filePath: destination, content }));
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: filename,
      ...(filename.endsWith('.pdf') ? { filters: [{ name: 'PDF', extensions: ['pdf'] }] } : {}),
    });
  });

  it('does not write a file when the save dialog is canceled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' });
    render(<LocaleProvider><CanvasPreview filePath="/tmp/report.html" content="original" interactionMode="read_only" /></LocaleProvider>);
    fireEvent.click(screen.getByTitle(/下载到本地|Download/i));
    await waitFor(() => expect(showSaveDialog).toHaveBeenCalled());
    expect(saveFile).not.toHaveBeenCalled();
  });
});
