import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtifactImage } from '../../renderer/src/components/ArtifactImage';
import { WorkspaceResource } from '../../renderer/src/components/WorkspaceResource';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const createObjectURL = vi.fn(() => 'blob:test-image');
const revokeObjectURL = vi.fn();

function mockImageFetch(contentType = 'image/png') {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null,
    },
    blob: async () => new Blob(['image'], { type: contentType }),
    text: async () => '',
  })));
}

describe('interactive media accessibility', () => {
  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
    });
    mockImageFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens and closes artifact image previews through labelled buttons', async () => {
    render(
      <ArtifactImage
        artifact={{
          artifactId: 'artifact-1',
          key: 'artifact-key',
          kind: 'png',
          title: 'Preview',
          filename: 'chart.png',
          createdAt: 'now',
          previewAvailable: true,
        }}
        accessToken="token"
      />,
    );

    const openButton = await screen.findByRole('button', { name: 'Open image preview: chart.png' });
    fireEvent.click(openButton);

    const closeImageButton = await screen.findByRole('button', { name: 'Close image preview: chart.png' });
    fireEvent.click(closeImageButton);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Close image preview: chart.png' })).not.toBeInTheDocument();
    });
  });

  it('opens and closes workspace image previews through labelled buttons', async () => {
    render(
      <LocaleProvider>
        <WorkspaceResource
          file={{ path: '/chart.png', filename: 'chart.png', mime_type: 'image/png' }}
          runId="run-1"
          accessToken="token"
        />
      </LocaleProvider>,
    );

    const openButton = await screen.findByRole('button', { name: 'Open image preview: chart.png' });
    fireEvent.click(openButton);

    const closeImageButton = await screen.findByRole('button', { name: 'Close image preview: chart.png' });
    fireEvent.click(closeImageButton);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Close image preview: chart.png' })).not.toBeInTheDocument();
    });
  });
});
