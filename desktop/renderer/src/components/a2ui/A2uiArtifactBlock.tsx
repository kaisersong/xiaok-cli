import React, { useEffect, useState } from 'react';
import { apiBaseUrl } from '../../shared/api/client';
import type { ArtifactRef } from '../../storage';
import { A2uiArtifactRenderer } from './A2uiArtifactRenderer';
import { useLocale } from '../../contexts/LocaleContext';

type Props = {
  artifactRef: ArtifactRef;
  accessToken?: string;
  content?: string;
};

export function A2uiArtifactBlock({ artifactRef, accessToken, content }: Props) {
  const { t } = useLocale();
  const [loadedContent, setLoadedContent] = useState<string | null>(content ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (typeof content === 'string') {
      setLoadedContent(content);
      setFailed(false);
      return;
    }
    if (!accessToken) {
      setLoadedContent(null);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setLoadedContent(null);
    const url = `${apiBaseUrl()}/v1/artifacts/${artifactRef.key || artifactRef.artifactId}`;
    fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const text = await res.text();
        if (!cancelled) setLoadedContent(text);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artifactRef.artifactId, artifactRef.key, accessToken, content]);

  if (failed) {
    return <div role="alert" style={{ color: 'var(--c-text-secondary)', fontSize: 13 }}>{t.a2uiLoadFailed}</div>;
  }
  if (!loadedContent) {
    return <div style={{ color: 'var(--c-text-tertiary)', fontSize: 13 }}>{t.a2uiLoading}</div>;
  }
  return <A2uiArtifactRenderer artifactContent={loadedContent} artifactRef={artifactRef} />;
}
