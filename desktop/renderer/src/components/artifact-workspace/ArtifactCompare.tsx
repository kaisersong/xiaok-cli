import { useEffect } from 'react';
import type { ArtifactWorkspacePreview } from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';

interface ArtifactCompareProps {
  left: ArtifactWorkspacePreview;
  right: ArtifactWorkspacePreview;
  onClose: () => void;
}

function CompareContent({ preview }: { preview: ArtifactWorkspacePreview }) {
  if (preview.contentKind === 'data_url' && typeof preview.content === 'string') {
    return <img src={preview.content} alt={preview.title} className="artifact-workspace-compare-image" />;
  }
  if (preview.contentKind === 'package_manifest' && typeof preview.content !== 'string') {
    return (
      <ol className="artifact-workspace-package-list">
        {preview.content.files.map((file) => <li key={file.path}>{file.path}</li>)}
      </ol>
    );
  }
  if (preview.kind === 'html' && typeof preview.content === 'string') {
    const document = new DOMParser().parseFromString(preview.content, 'text/html');
    return <div className="artifact-workspace-compare-text">{document.body.textContent}</div>;
  }
  return <pre className="artifact-workspace-compare-text">{String(preview.content)}</pre>;
}

export function ArtifactCompare({ left, right, onClose }: ArtifactCompareProps) {
  const { t } = useLocale();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.artifactWorkspace.compareTitle}
      className="artifact-workspace-compare"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header>
        <h2>{t.artifactWorkspace.compareTitle}</h2>
        <button type="button" onClick={onClose}>{t.artifactWorkspace.closeCompare}</button>
      </header>
      <div className="artifact-workspace-compare-grid">
        {[left, right].map((preview) => (
          <section key={preview.versionId}>
            <h3>{preview.title}</h3>
            <CompareContent preview={preview} />
          </section>
        ))}
      </div>
    </div>
  );
}
