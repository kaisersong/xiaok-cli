import { useEffect, useState } from 'react';
import type { ArtifactSummary } from '../../../../shared/task-types';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { A2uiArtifactRenderer } from './A2uiArtifactRenderer';
import { A2UI_MIME_TYPE } from '../../../../../src/a2ui/index';

/** A conversation block. The durable file is read through the existing main API. */
export function A2uiInlineCard({ artifact, preview }: {
  artifact?: ArtifactSummary;
  preview?: { toolUseId: string; title: string; content: string };
}) {
  const { t } = useLocale();
  const identity = artifact ? JSON.stringify([artifact.sourceTaskId, artifact.artifactId, artifact.filePath]) : '';
  const [loaded, setLoaded] = useState<{ identity: string; content?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!artifact) return;
    let cancelled = false;
    if (!artifact.filePath) {
      setLoaded({ identity, failed: true });
      return;
    }
    api.readFileContent(artifact.filePath).then(result => {
      if (!cancelled) setLoaded({ identity, ...(result.error ? { failed: true } : { content: result.content }) });
    }).catch(() => { if (!cancelled) setLoaded({ identity, failed: true }); });
    return () => { cancelled = true; };
  }, [identity, artifact?.filePath]);
  if (!artifact && !preview) return null;
  const current = loaded?.identity === identity ? loaded : null;
  const content = artifact ? current?.content : preview?.content;
  return <section data-testid="inline-ui-card" className="max-w-[663px] min-w-0" aria-label={artifact?.title ?? preview?.title}>
    {artifact && current?.failed ? <div role="alert" className="text-sm text-[var(--c-text-secondary)]">{t.chatView.a2uiLoadFailed}</div>
      : content === undefined ? <div className="text-sm text-[var(--c-text-tertiary)]">{t.chatView.a2uiLoading}</div>
        : <A2uiArtifactRenderer artifactContent={content} artifactRef={{ artifactId: artifact?.artifactId ?? preview!.toolUseId,
          type: 'artifact', key: artifact?.filePath, mime_type: artifact?.mimeType ?? A2UI_MIME_TYPE }} />}
  </section>;
}
