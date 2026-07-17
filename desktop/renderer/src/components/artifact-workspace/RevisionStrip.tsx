import type { ArtifactWorkspaceVersionView } from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';

interface RevisionStripProps {
  versions: ArtifactWorkspaceVersionView[];
  selectedVersionId?: string;
  writable: boolean;
  onSelect: (version: ArtifactWorkspaceVersionView) => void;
  onCompare: () => void;
  onPrefer: (version: ArtifactWorkspaceVersionView) => void;
  onDownload: (version: ArtifactWorkspaceVersionView) => void;
}

export function RevisionStrip({
  versions,
  selectedVersionId,
  writable,
  onSelect,
  onCompare,
  onPrefer,
  onDownload,
}: RevisionStripProps) {
  const { t } = useLocale();
  const selected = versions.find((version) => version.id === selectedVersionId);
  return (
    <section className="artifact-workspace-revisions" aria-label={t.artifactWorkspace.compareTitle}>
      <ul className="artifact-workspace-revision-list">
        {versions.map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-label={version.preview.title}
              aria-pressed={version.id === selectedVersionId}
              onClick={() => onSelect(version)}
              className="artifact-workspace-revision-chip"
            >
              <span>{version.preview.title}</span>
              {version.preferred ? <small>{t.artifactWorkspace.preferred}</small> : null}
              {version.status === 'missing' ? <small>{t.artifactWorkspace.missing}</small> : null}
              <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time>
            </button>
          </li>
        ))}
      </ul>
      <div className="artifact-workspace-object-actions">
        <button type="button" onClick={onCompare} disabled={!selected || selected.status === 'missing' || versions.length < 2}>
          {t.artifactWorkspace.compareVersions}
        </button>
        <button
          type="button"
          onClick={() => selected && onDownload(selected)}
          disabled={!selected || selected.status === 'missing'}
        >
          {t.artifactWorkspace.download}
        </button>
        {writable && selected && !selected.preferred ? (
          <button type="button" onClick={() => onPrefer(selected)}>
            {t.artifactWorkspace.setPreferred}
          </button>
        ) : null}
      </div>
    </section>
  );
}
