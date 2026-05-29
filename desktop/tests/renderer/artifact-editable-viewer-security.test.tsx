import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ArtifactEditableViewer } from '../../renderer/src/components/ArtifactEditableViewer';

describe('ArtifactEditableViewer sandbox policy', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:artifact-viewer-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not combine allow-scripts with allow-same-origin', () => {
    const { container } = render(
      <ArtifactEditableViewer
        htmlContent="<html><body><button>hello</button></body></html>"
        filePath="/tmp/artifact.html"
        onAnnotation={vi.fn()}
        onRevert={vi.fn()}
        onFinish={vi.fn()}
      />,
    );

    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    const sandbox = frame.getAttribute('sandbox') ?? '';

    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });
});
