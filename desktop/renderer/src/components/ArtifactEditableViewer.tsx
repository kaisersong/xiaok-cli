import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ARTIFACT_SDK_CODE } from '../lib/artifact-sdk';
import {
  artifactEditingReducer,
  INITIAL_STATE,
  SUBMIT_TIMEOUT_MS,
  type ArtifactEditingAction,
} from '../hooks/artifact-editing-state';
import { ArtifactToolbar } from './ArtifactToolbar';
import { HtmlEditInspector } from './html-edit/HtmlEditInspector';
import { applyEditPatch, markManualEdit } from '../lib/html-edit/source-patcher';
import type { EditPatch, EditTarget, InlineStylePatch } from '../lib/html-edit/types';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';

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
  /** Absolute path, artifact route, or stable edit target id */
  filePath: string;
  /** Optional save implementation for project-scoped artifacts */
  onSaveHtmlEdit?: (content: string) => Promise<{ ok?: boolean; success?: boolean; error?: string } | null | undefined>;
  /** External request to switch the initial viewer mode for a specific open action */
  editModeRequest?: { id: number; startInEditMode: boolean };
  /** Called when user submits an annotation */
  onAnnotation: (payload: AnnotationPayload) => void;
  /** Called when user clicks revert */
  onRevert: () => void;
  /** Called when editing session finishes */
  onFinish: () => void;
  /** Called when user clicks refresh */
  onRefresh?: () => void;
}

type HtmlEditApplyStatus = 'idle' | 'failed';

interface HtmlEditDesktopApi {
  saveFile?: (input: { filePath: string; content: string; purpose?: string }) => Promise<{ ok?: boolean; success?: boolean; error?: string }>;
  selectHtmlEditMedia?: (input: { kind: 'image' | 'svg' }) => Promise<{
    canceled?: boolean;
    filePath?: string;
    content?: string;
    error?: string;
  }>;
}

/**
 * Artifact viewer with live editing capabilities.
 * Renders HTML in a sandboxed iframe and injects the annotation SDK.
 */
export function ArtifactEditableViewer({
  htmlContent,
  filePath,
  onSaveHtmlEdit,
  editModeRequest,
  onAnnotation,
  onRevert,
  onFinish,
  onRefresh,
}: ArtifactEditableViewerProps) {
  const { t } = useLocale();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastEditModeRequestIdRef = useRef<number | null>(null);
  const [state, dispatch] = useReducer(artifactEditingReducer, INITIAL_STATE);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnchorRef = useRef<string | null>(null);
  const [draftSource, setDraftSource] = useState(htmlContent);
  const [htmlEditEnabled, setHtmlEditEnabled] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<EditTarget | null>(null);
  const [textValue, setTextValue] = useState('');
  const [hrefValue, setHrefValue] = useState('');
  const [colorValue, setColorValue] = useState('');
  const [fontSizeValue, setFontSizeValue] = useState('');
  const [fontFamilyValue, setFontFamilyValue] = useState('');
  const [fontWeightValue, setFontWeightValue] = useState('');
  const [imageUrlValue, setImageUrlValue] = useState('');
  const [imageAltValue, setImageAltValue] = useState('');
  const [imageCaptionValue, setImageCaptionValue] = useState('');
  const [svgSourceValue, setSvgSourceValue] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [applyStatus, setApplyStatus] = useState<HtmlEditApplyStatus>('idle');
  const [undoStack, setUndoStack] = useState<Array<{ before: string; after: string }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ before: string; after: string }>>([]);

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  const confirmDiscardDirty = useCallback(() => {
    if (!dirty) return true;
    return window.confirm(t.artifactHtmlUnsavedConfirm);
  }, [dirty, t.artifactHtmlUnsavedConfirm]);

  useEffect(() => {
    setDraftSource(htmlContent);
    setHtmlEditEnabled(false);
    setSelectedTarget(null);
    setTextValue('');
    setHrefValue('');
    setColorValue('');
    setFontSizeValue('');
    setFontFamilyValue('');
    setFontWeightValue('');
    setImageUrlValue('');
    setImageAltValue('');
    setImageCaptionValue('');
    setSvgSourceValue('');
    setDirty(false);
    setSaveStatus('idle');
    setApplyStatus('idle');
    setUndoStack([]);
    setRedoStack([]);
  }, [filePath, htmlContent]);

  useEffect(() => {
    if (!editModeRequest || editModeRequest.id === 0 || lastEditModeRequestIdRef.current === editModeRequest.id) return;
    lastEditModeRequestIdRef.current = editModeRequest.id;

    if (!editModeRequest.startInEditMode) {
      setHtmlEditEnabled(false);
      setSelectedTarget(null);
      postToFrame({ type: 'xiaok:setEditMode', enabled: false });
      return;
    }

    if (state === 'annotating') {
      dispatch({ type: 'CANCEL_ANNOTATING' });
      postToFrame({ type: 'xiaok:setAnnotationMode', enabled: false });
    }
    setHtmlEditEnabled(true);
    setSaveStatus('idle');
    setApplyStatus('idle');
    postToFrame({ type: 'xiaok:setEditMode', enabled: true });
  }, [editModeRequest, postToFrame, state]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // Listen for postMessage from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source && iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) {
        return;
      }
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
      } else if (msg.type === 'xiaok:editSelect') {
        const target = msg.payload as EditTarget;
        setSelectedTarget(target);
        setTextValue(target.text ?? '');
        setHrefValue(target.href ?? '');
        setColorValue(target.style?.color ?? '');
        setFontSizeValue(target.style?.fontSize ?? '');
        setFontFamilyValue(target.style?.fontFamily ?? '');
        setFontWeightValue(target.style?.fontWeight ?? '');
        setSaveStatus('idle');
        setApplyStatus('idle');
      } else if (msg.type === 'xiaok:editDeselect') {
        setSelectedTarget(null);
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
    if (htmlEditEnabled) {
      postToFrame({ type: 'xiaok:setEditMode', enabled: true });
      return;
    }
    if (state === 'annotating' || state === 'reviewing' || state === 'timeout_idle') {
      postToFrame({ type: 'xiaok:setAnnotationMode', enabled: true });
    }
  }, [htmlEditEnabled, postToFrame, state]);

  // Toggle annotation mode
  const handleToggleAnnotate = useCallback(() => {
    if (htmlEditEnabled) {
      if (!confirmDiscardDirty()) return;
      setHtmlEditEnabled(false);
      setSelectedTarget(null);
      postToFrame({ type: 'xiaok:setEditMode', enabled: false });
    }
    if (state === 'annotating') {
      dispatch({ type: 'CANCEL_ANNOTATING' });
      postToFrame({ type: 'xiaok:setAnnotationMode', enabled: false });
    } else {
      dispatch({ type: 'START_ANNOTATING' });
      postToFrame({ type: 'xiaok:setAnnotationMode', enabled: true });
    }
  }, [confirmDiscardDirty, htmlEditEnabled, postToFrame, state]);

  const handleToggleHtmlEdit = useCallback(() => {
    if (htmlEditEnabled) {
      if (!confirmDiscardDirty()) return;
      setHtmlEditEnabled(false);
      setSelectedTarget(null);
      postToFrame({ type: 'xiaok:setEditMode', enabled: false });
      return;
    }

    if (state === 'annotating') {
      dispatch({ type: 'CANCEL_ANNOTATING' });
      postToFrame({ type: 'xiaok:setAnnotationMode', enabled: false });
    }
    setHtmlEditEnabled(true);
    setSaveStatus('idle');
    setApplyStatus('idle');
    postToFrame({ type: 'xiaok:setEditMode', enabled: true });
  }, [confirmDiscardDirty, htmlEditEnabled, postToFrame, state]);

  const applyHtmlPatch = useCallback((patch: EditPatch, options?: { clearSelection?: boolean }) => {
    if (!selectedTarget) return false;
    const result = applyEditPatch(draftSource, patch, selectedTarget);
    if (result.source === draftSource) {
      setApplyStatus('failed');
      return false;
    }
    setUndoStack((entries) => [...entries, { before: draftSource, after: result.source }].slice(-50));
    setRedoStack([]);
    setDraftSource(result.source);
    setSelectedTarget(options?.clearSelection ? null : result.updatedTarget);
    setDirty(true);
    setSaveStatus('idle');
    setApplyStatus('idle');
    return true;
  }, [draftSource, selectedTarget]);

  const handleApplyHtmlEdit = useCallback(() => {
    if (!selectedTarget) return;
    const patch: EditPatch = selectedTarget.kind === 'link'
      ? {
          targetId: selectedTarget.id,
          kind: 'set-link',
          payload: { text: textValue, href: hrefValue },
        }
      : {
          targetId: selectedTarget.id,
          kind: 'set-text',
          payload: { text: textValue },
        };
    applyHtmlPatch(patch);
  }, [applyHtmlPatch, hrefValue, selectedTarget, textValue]);

  const handleDeleteHtmlElement = useCallback(() => {
    if (!selectedTarget) return;
    applyHtmlPatch({
      targetId: selectedTarget.id,
      kind: 'remove-element',
      payload: {},
    }, { clearSelection: true });
  }, [applyHtmlPatch, selectedTarget]);

  const handleApplyStyle = useCallback(() => {
    if (!selectedTarget) return;
    const style: InlineStylePatch = {
      color: colorValue,
      fontSize: fontSizeValue,
      fontFamily: fontFamilyValue,
      fontWeight: fontWeightValue,
    };
    applyHtmlPatch({
      targetId: selectedTarget.id,
      kind: 'set-style',
      payload: { style },
    });
  }, [applyHtmlPatch, colorValue, fontFamilyValue, fontSizeValue, fontWeightValue, selectedTarget]);

  const handleInsertImage = useCallback(() => {
    if (!selectedTarget) return;
    const applied = applyHtmlPatch({
      targetId: selectedTarget.id,
      kind: 'insert-image-after',
      payload: {
        imageUrl: imageUrlValue,
        imageAlt: imageAltValue,
        caption: imageCaptionValue,
      },
    });
    if (!applied) return;
    setImageUrlValue('');
    setImageAltValue('');
    setImageCaptionValue('');
  }, [applyHtmlPatch, imageAltValue, imageCaptionValue, imageUrlValue, selectedTarget]);

  const handleInsertSvg = useCallback(() => {
    if (!selectedTarget) return;
    const applied = applyHtmlPatch({
      targetId: selectedTarget.id,
      kind: 'insert-svg-after',
      payload: {
        svgSource: svgSourceValue,
      },
    });
    if (!applied) return;
    setSvgSourceValue('');
  }, [applyHtmlPatch, selectedTarget, svgSourceValue]);

  const handleChooseLocalImage = useCallback(async () => {
    const api = getDesktopApi() as HtmlEditDesktopApi | null;
    try {
      const result = await api?.selectHtmlEditMedia?.({ kind: 'image' });
      if (!result || result.canceled || result.error || !result.content) {
        setApplyStatus('failed');
        return;
      }
      setImageUrlValue(result.content);
      setApplyStatus('idle');
    } catch {
      setApplyStatus('failed');
    }
  }, []);

  const handleChooseLocalSvg = useCallback(async () => {
    const api = getDesktopApi() as HtmlEditDesktopApi | null;
    try {
      const result = await api?.selectHtmlEditMedia?.({ kind: 'svg' });
      if (!result || result.canceled || result.error || !result.content) {
        setApplyStatus('failed');
        return;
      }
      setSvgSourceValue(result.content);
      setApplyStatus('idle');
    } catch {
      setApplyStatus('failed');
    }
  }, []);

  const handleUndoHtmlEdit = useCallback(() => {
    setUndoStack((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return entries;
      const nextEntries = entries.slice(0, -1);
      setRedoStack((redoEntries) => [last, ...redoEntries].slice(0, 50));
      setDraftSource(last.before);
      setSelectedTarget(null);
      setDirty(nextEntries.length > 0 || last.before !== htmlContent);
      setSaveStatus('idle');
      setApplyStatus('idle');
      return nextEntries;
    });
  }, [htmlContent]);

  const handleRedoHtmlEdit = useCallback(() => {
    setRedoStack((entries) => {
      const first = entries[0];
      if (!first) return entries;
      setUndoStack((undoEntries) => [...undoEntries, first].slice(-50));
      setDraftSource(first.after);
      setSelectedTarget(null);
      setDirty(true);
      setSaveStatus('idle');
      setApplyStatus('idle');
      return entries.slice(1);
    });
  }, []);

  const handleSaveHtmlEdit = useCallback(async () => {
    const markedSource = markManualEdit(draftSource);
    setSaveStatus('saving');
    setApplyStatus('idle');
    try {
      const api = getDesktopApi() as HtmlEditDesktopApi | null;
      const result = onSaveHtmlEdit
        ? await onSaveHtmlEdit(markedSource)
        : await api?.saveFile?.({ filePath, content: markedSource, purpose: 'html-edit' });
      if (!result || (!result.ok && !result.success)) {
        setSaveStatus('failed');
        return;
      }
      setDraftSource(markedSource);
      setDirty(false);
      setUndoStack([]);
      setRedoStack([]);
      setSaveStatus('saved');
      onRefresh?.();
    } catch {
      setSaveStatus('failed');
    }
  }, [draftSource, filePath, onRefresh, onSaveHtmlEdit]);

  const handleRevert = useCallback(() => {
    if (!confirmDiscardDirty()) return;
    onRevert();
    dispatch({ type: 'RESET' });
    setHtmlEditEnabled(false);
    setSelectedTarget(null);
    setDirty(false);
    setDraftSource(htmlContent);
    setApplyStatus('idle');
  }, [confirmDiscardDirty, htmlContent, onRevert]);

  const handleFinish = useCallback(() => {
    if (!confirmDiscardDirty()) return;
    onFinish();
    dispatch({ type: 'FINISH' });
    dispatch({ type: 'RESET' });
    setHtmlEditEnabled(false);
    setSelectedTarget(null);
    setApplyStatus('idle');
  }, [confirmDiscardDirty, onFinish]);

  // Notify file changed (called externally via ref or context)
  const notifyFileChanged = useCallback(() => {
    // Save scroll anchor before reload
    postToFrame({ type: 'xiaok:getScrollAnchor' });
    dispatch({ type: 'FILE_CHANGED' } as ArtifactEditingAction);
  }, [postToFrame]);

  // Create blob URL with SDK embedded for sandbox iframe
  const blobUrl = React.useMemo(() => {
    // Inject SDK script into HTML content
    const sdkScript = `<script>${ARTIFACT_SDK_CODE}<\/script>`;
    let injectedHtml: string;
    if (draftSource.includes('</body>')) {
      injectedHtml = draftSource.replace('</body>', `${sdkScript}</body>`);
    } else if (draftSource.includes('</html>')) {
      injectedHtml = draftSource.replace('</html>', `${sdkScript}</html>`);
    } else {
      injectedHtml = draftSource + sdkScript;
    }
    const blob = new Blob([injectedHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [draftSource]);

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  return (
    <div className="artifact-editable-viewer">
      <div className="artifact-editable-stage">
        <iframe
          ref={iframeRef}
          src={blobUrl}
          title="Artifact preview"
          sandbox="allow-scripts allow-forms allow-popups allow-downloads"
          onLoad={handleIframeLoad}
          className="artifact-editable-iframe"
        />
        <HtmlEditInspector
          enabled={htmlEditEnabled}
          target={selectedTarget}
          textValue={textValue}
          hrefValue={hrefValue}
          colorValue={colorValue}
          fontSizeValue={fontSizeValue}
          fontFamilyValue={fontFamilyValue}
          fontWeightValue={fontWeightValue}
          imageUrlValue={imageUrlValue}
          imageAltValue={imageAltValue}
          imageCaptionValue={imageCaptionValue}
          svgSourceValue={svgSourceValue}
          dirty={dirty}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          saveStatus={saveStatus}
          applyStatus={applyStatus}
          onTextChange={setTextValue}
          onHrefChange={setHrefValue}
          onColorChange={setColorValue}
          onFontSizeChange={setFontSizeValue}
          onFontFamilyChange={setFontFamilyValue}
          onFontWeightChange={setFontWeightValue}
          onImageUrlChange={setImageUrlValue}
          onImageAltChange={setImageAltValue}
          onImageCaptionChange={setImageCaptionValue}
          onSvgSourceChange={setSvgSourceValue}
          onApply={handleApplyHtmlEdit}
          onDelete={handleDeleteHtmlElement}
          onApplyStyle={handleApplyStyle}
          onChooseLocalImage={handleChooseLocalImage}
          onInsertImage={handleInsertImage}
          onChooseLocalSvg={handleChooseLocalSvg}
          onInsertSvg={handleInsertSvg}
          onUndo={handleUndoHtmlEdit}
          onRedo={handleRedoHtmlEdit}
        />
      </div>
      <ArtifactToolbar
        state={state}
        isHtmlEditing={htmlEditEnabled}
        isHtmlDirty={dirty}
        canUndoHtmlEdit={undoStack.length > 0}
        canRedoHtmlEdit={redoStack.length > 0}
        onToggleAnnotate={handleToggleAnnotate}
        onToggleHtmlEdit={handleToggleHtmlEdit}
        onSaveHtmlEdit={handleSaveHtmlEdit}
        onUndoHtmlEdit={handleUndoHtmlEdit}
        onRedoHtmlEdit={handleRedoHtmlEdit}
        onRevert={handleRevert}
        onFinish={handleFinish}
        onRefresh={onRefresh}
      />
    </div>
  );
}
