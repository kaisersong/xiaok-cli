// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { CanvasPreview } from '../../renderer/src/components/CanvasPreview';

const pdfMocks = vi.hoisted(() => {
  const renderMock = vi.fn(() => ({ promise: Promise.resolve() }));
  const cleanupMock = vi.fn();
  const loadingTaskDestroyMock = vi.fn(() => Promise.resolve());
  const getPageMock = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render: renderMock,
    cleanup: cleanupMock,
  }));
  const getDocumentMock = vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: getPageMock,
    }),
    destroy: loadingTaskDestroyMock,
  }));
  return { cleanupMock, getDocumentMock, getPageMock, loadingTaskDestroyMock, renderMock };
});

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'mock-pdf-worker-url' }));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfMocks.getDocumentMock,
}));

describe('CanvasPreview PDF preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a PDF data URL through pdf.js canvases instead of an Electron iframe', async () => {
    const pdfDataUrl = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nbinary').toString('base64')}`;

    const { container } = render(
      <LocaleProvider>
        <CanvasPreview filePath="/tmp/report.pdf" content={pdfDataUrl} />
      </LocaleProvider>,
    );

    const preview = screen.getByLabelText(/report\.pdf/);
    await waitFor(() => expect(pdfMocks.getDocumentMock).toHaveBeenCalled());
    expect(pdfMocks.getDocumentMock.mock.calls[0]?.[0]?.data).toBeInstanceOf(Uint8Array);
    await waitFor(() => expect(preview.querySelectorAll('canvas')).toHaveLength(2));
    expect(pdfMocks.renderMock).toHaveBeenCalledTimes(2);
    expect(pdfMocks.renderMock.mock.calls[0]?.[0]).toMatchObject({ canvas: null });
    expect(pdfMocks.loadingTaskDestroyMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre code')).toBeNull();
  });
});
