// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { CanvasPreview } from '../../renderer/src/components/CanvasPreview';

describe('CanvasPreview PDF preview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a PDF data URL in an iframe instead of showing encoded bytes as code', () => {
    const pdfDataUrl = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nbinary').toString('base64')}`;

    const { container } = render(
      <LocaleProvider>
        <CanvasPreview filePath="/tmp/report.pdf" content={pdfDataUrl} />
      </LocaleProvider>,
    );

    const frame = screen.getByTitle('PDF preview: report.pdf') as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe(pdfDataUrl);
    expect(container.querySelector('pre code')).toBeNull();
  });
});
