import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { ARTIFACT_SDK_CODE } from '../lib/artifact-sdk';
import {
  artifactEditingReducer,
  INITIAL_STATE,
  SUBMIT_TIMEOUT_MS,
  type ArtifactEditingAction,
} from '../hooks/artifact-editing-state';
import { ArtifactToolbar } from './ArtifactToolbar';

export interface AnnotationPayload {
  type: 'element' | 'text-selection';
  selector: string;
  text: string;
  snapshot: string;
  prompt: string;
  target?: unknown;
}

interface ArtifactEditableViewerProps {
  /** HTML content to render */
  htmlContent: string;
  /** Absolute path to the artifact file */
  filePath: string;
  /** Called when user submits an annotation */
  onAnnotation: (payload: AnnotationPayload) => void;
  /** Called when user clicks revert */
  onRevert: () => void;
  /** Called when editing session finishes */
  onFinish: () => void;
  /** Called when user clicks refresh */
  onRefresh?: () => void;
}

/**
 * Artifact viewer with live editing capabilities.
 * Renders HTML in a sandboxed iframe and injects the annotation SDK.
 */
export function ArtifactEditableViewer({
  htmlContent,
  filePath,
  onAnnotation,
  onRevert,
  onFinish,
  onRefresh,
}: ArtifactEditableViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, dispatch] = useReducer(artifactEditingReducer, INITIAL_STATE);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnchorRef = useRef<string | null>(null);

  // Listen for postMessage from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'xiaok:annotation') {
        onAnnotation(msg.payload as AnnotationPayload);
        dispatch({ type: 'SUBMIT' });
      } else if (msg.type === 'xiaok:sdkReady') {
        // SDK loaded, restore scroll if needed
        if (scrollAnchorRef.current) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'xiaok:restoreScroll', selector: scrollAnchorRef.current },
            '*',
          );
          scrollAnchorRef.current = null;
        }
      } else if (msg.type === 'xiaok:scrollAnchor') {
        scrollAnchorRef.current = msg.selector || null;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAnnotation]);

  // Timeout for submitted state
  useEffect(() => {
    if (state === 'submitted') {
      timeoutRef.current = setTimeout(() => {
        dispatch({ type: 'TIMEOUT' });
      }, SUBMIT_TIMEOUT_MS);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [state]);

  // Inject SDK when iframe loads and annotation mode is active
  const handleIframeLoad = useCallback(() => {
    if (state === 'annotating' || state === 'reviewing' || state === 'timeout_idle') {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'xiaok:setAnnotationMode', enabled: true },
        '*',
      );
    }
  }, [state]);

  // Toggle annotation mode
  const handleToggleAnnotate = useCallback(() => {
    if (state === 'annotating') {
      dispatch({ type: 'CANCEL_ANNOTATING' });
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'xiaok:setAnnotationMode', enabled: false },
        '*',
      );
    } else {
      dispatch({ type: 'START_ANNOTATING' });
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'xiaok:setAnnotationMode', enabled: true },
        '*',
      );
    }
  }, [state]);

  const handleRevert = useCallback(() => {
    onRevert();
    dispatch({ type: 'RESET' });
  }, [onRevert]);

  const handleFinish = useCallback(() => {
    onFinish();
    dispatch({ type: 'FINISH' });
    dispatch({ type: 'RESET' });
  }, [onFinish]);

  // Notify file changed (called externally via ref or context)
  const notifyFileChanged = useCallback(() => {
    // Save scroll anchor before reload
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'xiaok:getScrollAnchor' },
      '*',
    );
    dispatch({ type: 'FILE_CHANGED' } as ArtifactEditingAction);
  }, []);

  // Create blob URL with SDK embedded for sandbox iframe
  const blobUrl = React.useMemo(() => {
    // Inject SDK script into HTML content
    const sdkScript = `<script>${ARTIFACT_SDK_CODE}<\/script>`;
    let injectedHtml: string;
    if (htmlContent.includes('</body>')) {
      injectedHtml = htmlContent.replace('</body>', `${sdkScript}</body>`);
    } else if (htmlContent.includes('</html>')) {
      injectedHtml = htmlContent.replace('</html>', `${sdkScript}</html>`);
    } else {
      injectedHtml = htmlContent + sdkScript;
    }
    const blob = new Blob([injectedHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [htmlContent]);

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  return (
    <div className="artifact-editable-viewer">
      <iframe
        ref={iframeRef}
        src={blobUrl}
        title="Artifact preview"
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        onLoad={handleIframeLoad}
        className="artifact-editable-iframe"
      />
      <ArtifactToolbar
        state={state}
        onToggleAnnotate={handleToggleAnnotate}
        onRevert={handleRevert}
        onFinish={handleFinish}
        onRefresh={onRefresh}
      />
    </div>
  );
}
