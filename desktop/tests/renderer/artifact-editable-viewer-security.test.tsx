import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ArtifactEditableViewer } from '../../renderer/src/components/ArtifactEditableViewer';

type ArtifactEditableViewerContractProps = React.ComponentProps<typeof ArtifactEditableViewer> & {
  interactionActive?: boolean;
};

const ArtifactEditableViewerWithContract = ArtifactEditableViewer as React.ComponentType<
  ArtifactEditableViewerContractProps
>;

function dispatchArtifactMessage(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  const source = frame.contentWindow;
  if (!source) throw new Error('artifact iframe contentWindow unavailable');
  fireEvent(window, new MessageEvent('message', { data, source }));
}

describe('ArtifactEditableViewer sandbox policy', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:artifact-viewer-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the same sandbox policy and iframe DOM while active and inactive', () => {
    const onAnnotation = vi.fn();
    const onRevert = vi.fn();
    const onFinish = vi.fn();
    const viewer = (interactionActive: boolean) => (
      <LocaleProvider>
        <ArtifactEditableViewerWithContract
          htmlContent="<html><body><button>hello</button></body></html>"
          filePath="/tmp/artifact.html"
          interactionActive={interactionActive}
          onAnnotation={onAnnotation}
          onRevert={onRevert}
          onFinish={onFinish}
        />
      </LocaleProvider>
    );
    const view = render(viewer(true));

    const activeFrame = view.container.querySelector('iframe') as HTMLIFrameElement;
    expect(activeFrame).not.toBeNull();
    const activeSandbox = activeFrame.getAttribute('sandbox') ?? '';

    view.rerender(viewer(false));
    const inactiveFrame = view.container.querySelector('iframe') as HTMLIFrameElement;
    const inactiveSandbox = inactiveFrame.getAttribute('sandbox') ?? '';

    expect(inactiveFrame).toBe(activeFrame);
    expect(inactiveSandbox).toBe(activeSandbox);
    expect(inactiveSandbox).toContain('allow-scripts');
    expect(inactiveSandbox).not.toContain('allow-same-origin');
  });

  it('drops inactive iframe messages without mutating state, invoking callbacks, or replaying them on resume', async () => {
    const onAnnotation = vi.fn();
    const onRevert = vi.fn();
    const onFinish = vi.fn();
    const viewer = (interactionActive: boolean) => (
      <LocaleProvider>
        <ArtifactEditableViewerWithContract
          htmlContent="<html><body><h1>Baseline</h1></body></html>"
          filePath="/tmp/artifact.html"
          interactionActive={interactionActive}
          onAnnotation={onAnnotation}
          onRevert={onRevert}
          onFinish={onFinish}
        />
      </LocaleProvider>
    );
    const view = render(viewer(true));
    const frame = view.container.querySelector('iframe') as HTMLIFrameElement;
    const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      source: window,
      data: {
        type: 'xiaok:annotation',
        payload: {
          type: 'element',
          selector: '#wrong-source',
          text: 'Wrong source annotation',
          snapshot: '<p>Wrong source</p>',
          prompt: 'Reject this',
        },
      },
    }));
    expect(onAnnotation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    dispatchArtifactMessage(frame, {
      type: 'xiaok:editSelect',
      payload: {
        id: 'baseline-h1',
        kind: 'text',
        tagName: 'h1',
        selector: 'h1',
        text: 'Baseline',
        outerHtml: '<h1>Baseline</h1>',
        sourceOccurrence: 0,
      },
    });
    expect(await screen.findByLabelText(/文本内容|Text content/i)).toHaveValue('Baseline');

    view.rerender(viewer(false));
    postMessageSpy.mockClear();
    dispatchArtifactMessage(frame, {
      type: 'xiaok:annotation',
      payload: {
        type: 'element',
        selector: '#inactive',
        text: 'Inactive annotation',
        snapshot: '<p>Inactive</p>',
        prompt: 'Ignore this',
      },
    });
    dispatchArtifactMessage(frame, { type: 'xiaok:scrollAnchor', selector: '#inactive' });
    dispatchArtifactMessage(frame, { type: 'xiaok:sdkReady' });
    dispatchArtifactMessage(frame, {
      type: 'xiaok:editSelect',
      payload: {
        id: 'inactive-h1',
        kind: 'text',
        tagName: 'h1',
        selector: '#inactive',
        text: 'Inactive selection',
        outerHtml: '<h1>Inactive selection</h1>',
        sourceOccurrence: 0,
      },
    });
    dispatchArtifactMessage(frame, { type: 'xiaok:editDeselect' });

    expect(onAnnotation).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalledWith(
      { type: 'xiaok:restoreScroll', selector: '#inactive' },
      '*',
    );
    expect(screen.getByLabelText(/文本内容|Text content/i)).toHaveValue('Baseline');

    postMessageSpy.mockClear();
    view.rerender(viewer(true));
    expect(view.container.querySelector('iframe')).toBe(frame);
    expect(onAnnotation).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalledWith(
      { type: 'xiaok:restoreScroll', selector: '#inactive' },
      '*',
    );
    expect(screen.getByLabelText(/文本内容|Text content/i)).toHaveValue('Baseline');

    const activeAnnotation = {
      type: 'element' as const,
      selector: '#active',
      text: 'Active annotation',
      snapshot: '<p>Active</p>',
      prompt: 'Handle this',
    };
    dispatchArtifactMessage(frame, { type: 'xiaok:annotation', payload: activeAnnotation });
    expect(onAnnotation).toHaveBeenCalledTimes(1);
    expect(onAnnotation).toHaveBeenCalledWith(activeAnnotation);

    dispatchArtifactMessage(frame, {
      type: 'xiaok:editSelect',
      payload: {
        id: 'active-h1',
        kind: 'text',
        tagName: 'h1',
        selector: '#active',
        text: 'Active selection',
        outerHtml: '<h1>Active selection</h1>',
        sourceOccurrence: 0,
      },
    });
    expect(screen.getByLabelText(/文本内容|Text content/i)).toHaveValue('Active selection');

    dispatchArtifactMessage(frame, { type: 'xiaok:scrollAnchor', selector: '#active' });
    dispatchArtifactMessage(frame, { type: 'xiaok:sdkReady' });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'xiaok:restoreScroll', selector: '#active' },
      '*',
    );

    dispatchArtifactMessage(frame, { type: 'xiaok:editDeselect' });
    expect(screen.queryByLabelText(/文本内容|Text content/i)).toBeNull();
  });
});
