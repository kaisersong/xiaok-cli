import React from 'react';
import type { EditTarget } from '../../lib/html-edit/types';
import { useLocale } from '../../contexts/LocaleContext';

interface HtmlEditInspectorProps {
  enabled: boolean;
  target: EditTarget | null;
  textValue: string;
  hrefValue: string;
  colorValue: string;
  fontSizeValue: string;
  fontFamilyValue: string;
  fontWeightValue: string;
  imageUrlValue: string;
  imageAltValue: string;
  imageCaptionValue: string;
  svgSourceValue: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'failed';
  applyStatus: 'idle' | 'failed';
  onTextChange: (value: string) => void;
  onHrefChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onFontSizeChange: (value: string) => void;
  onFontFamilyChange: (value: string) => void;
  onFontWeightChange: (value: string) => void;
  onImageUrlChange: (value: string) => void;
  onImageAltChange: (value: string) => void;
  onImageCaptionChange: (value: string) => void;
  onSvgSourceChange: (value: string) => void;
  onApply: () => void;
  onDelete: () => void;
  onApplyStyle: () => void;
  onChooseLocalImage: () => void;
  onInsertImage: () => void;
  onChooseLocalSvg: () => void;
  onInsertSvg: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function HtmlEditInspector({
  enabled,
  target,
  textValue,
  hrefValue,
  colorValue,
  fontSizeValue,
  fontFamilyValue,
  fontWeightValue,
  imageUrlValue,
  imageAltValue,
  imageCaptionValue,
  svgSourceValue,
  dirty,
  canUndo,
  canRedo,
  saveStatus,
  applyStatus,
  onTextChange,
  onHrefChange,
  onColorChange,
  onFontSizeChange,
  onFontFamilyChange,
  onFontWeightChange,
  onImageUrlChange,
  onImageAltChange,
  onImageCaptionChange,
  onSvgSourceChange,
  onApply,
  onDelete,
  onApplyStyle,
  onChooseLocalImage,
  onInsertImage,
  onChooseLocalSvg,
  onInsertSvg,
  onUndo,
  onRedo,
}: HtmlEditInspectorProps) {
  const { t } = useLocale();

  if (!enabled) return null;

  return (
    <aside className="html-edit-inspector" aria-label={t.artifactHtmlInspectorTitle}>
      <div className="html-edit-inspector__header">
        <div>
          <div className="html-edit-inspector__title">{t.artifactHtmlInspectorTitle}</div>
          <div className="html-edit-inspector__subtitle">
            {target ? `${target.tagName.toLowerCase()} · ${target.selector}` : t.artifactHtmlSelectHint}
          </div>
        </div>
        {dirty && <span className="html-edit-inspector__dirty">{t.artifactHtmlDirtyStatus}</span>}
      </div>

      {target ? (
        <div className="html-edit-inspector__body">
          <label className="html-edit-field">
            <span>{target.kind === 'link' ? t.artifactHtmlLinkTextLabel : t.artifactHtmlTextLabel}</span>
            <textarea
              value={textValue}
              onChange={(event) => onTextChange(event.currentTarget.value)}
              rows={4}
            />
          </label>

          {target.kind === 'link' && (
            <label className="html-edit-field">
              <span>{t.artifactHtmlHrefLabel}</span>
              <input
                value={hrefValue}
                onChange={(event) => onHrefChange(event.currentTarget.value)}
              />
            </label>
          )}

          <div className="html-edit-inspector__actions">
            <button type="button" className="artifact-toolbar-btn" onClick={onApply}>
              {t.artifactHtmlApply}
            </button>
            <button type="button" className="artifact-toolbar-btn danger" onClick={onDelete}>
              {t.artifactHtmlDeleteComponent}
            </button>
            <button type="button" className="artifact-toolbar-btn" onClick={onUndo} disabled={!canUndo}>
              {t.artifactHtmlUndo}
            </button>
            <button type="button" className="artifact-toolbar-btn" onClick={onRedo} disabled={!canRedo}>
              {t.artifactHtmlRedo}
            </button>
          </div>

          <section className="html-edit-inspector__section">
            <div className="html-edit-inspector__section-title">{t.artifactHtmlStyleSection}</div>
            <div className="html-edit-grid">
              <label className="html-edit-field">
                <span>{t.artifactHtmlColorLabel}</span>
                <input
                  value={colorValue}
                  onChange={(event) => onColorChange(event.currentTarget.value)}
                  placeholder="#111827"
                />
              </label>
              <label className="html-edit-field">
                <span>{t.artifactHtmlFontSizeLabel}</span>
                <input
                  value={fontSizeValue}
                  onChange={(event) => onFontSizeChange(event.currentTarget.value)}
                  placeholder="24px"
                />
              </label>
              <label className="html-edit-field">
                <span>{t.artifactHtmlFontFamilyLabel}</span>
                <input
                  value={fontFamilyValue}
                  onChange={(event) => onFontFamilyChange(event.currentTarget.value)}
                  placeholder="Inter"
                />
              </label>
              <label className="html-edit-field">
                <span>{t.artifactHtmlFontWeightLabel}</span>
                <input
                  value={fontWeightValue}
                  onChange={(event) => onFontWeightChange(event.currentTarget.value)}
                  placeholder="700"
                />
              </label>
            </div>
            <button type="button" className="artifact-toolbar-btn" onClick={onApplyStyle}>
              {t.artifactHtmlApplyStyle}
            </button>
          </section>

          <section className="html-edit-inspector__section">
            <div className="html-edit-inspector__section-title">{t.artifactHtmlMediaSection}</div>
            <label className="html-edit-field">
              <span>{t.artifactHtmlImageUrlLabel}</span>
              <input
                value={imageUrlValue}
                onChange={(event) => onImageUrlChange(event.currentTarget.value)}
                placeholder="https://example.com/image.png"
              />
            </label>
            <label className="html-edit-field">
              <span>{t.artifactHtmlImageAltLabel}</span>
              <input
                value={imageAltValue}
                onChange={(event) => onImageAltChange(event.currentTarget.value)}
              />
            </label>
            <label className="html-edit-field">
              <span>{t.artifactHtmlImageCaptionLabel}</span>
              <input
                value={imageCaptionValue}
                onChange={(event) => onImageCaptionChange(event.currentTarget.value)}
              />
            </label>
            <div className="html-edit-media-actions">
              <button type="button" className="html-edit-media-button" onClick={onChooseLocalImage}>
                {t.artifactHtmlChooseImageFile}
              </button>
              <button type="button" className="html-edit-media-button primary" onClick={onInsertImage}>
                {t.artifactHtmlInsertImage}
              </button>
            </div>
            <label className="html-edit-field">
              <span>{t.artifactHtmlSvgSourceLabel}</span>
              <textarea
                value={svgSourceValue}
                onChange={(event) => onSvgSourceChange(event.currentTarget.value)}
                rows={4}
                placeholder="<svg viewBox=&quot;0 0 10 10&quot;>...</svg>"
              />
            </label>
            <div className="html-edit-media-actions">
              <button type="button" className="html-edit-media-button" onClick={onChooseLocalSvg}>
                {t.artifactHtmlChooseSvgFile}
              </button>
              <button type="button" className="html-edit-media-button primary" onClick={onInsertSvg}>
                {t.artifactHtmlInsertSvg}
              </button>
            </div>
          </section>
          {applyStatus === 'failed' && (
            <div className="html-edit-inspector__error">{t.artifactHtmlApplyFailed}</div>
          )}
          {saveStatus === 'failed' && (
            <div className="html-edit-inspector__error">{t.artifactHtmlSaveFailed}</div>
          )}
          {saveStatus === 'saved' && (
            <div className="html-edit-inspector__saved">{t.artifactHtmlSavedStatus}</div>
          )}
        </div>
      ) : (
        <div className="html-edit-inspector__empty">{t.artifactHtmlNoSelection}</div>
      )}
    </aside>
  );
}
