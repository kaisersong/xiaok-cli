import { useEffect, useRef, useState } from 'react';
import type { ThreadRecord } from '../api/types';
import type { LegacyContextPreview } from '../../../shared/context-continuity-types';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';

/** Renderer submits only E3 candidates; main verifies each real source before any claim. */
export function LegacyContextImport({ thread, onClaimed }: { thread: ThreadRecord; onClaimed?: () => void }) {
  const { t } = useLocale(), l = t.contextContinuity;
  const [preview, setPreview] = useState<LegacyContextPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0), inFlight = useRef(false);
  const candidates = [...new Set(thread.coverage === 'unclaimed' ? [...thread.taskIds, ...(thread.currentTaskId ? [thread.currentTaskId] : [])] : thread.legacyTaskIds ?? [])];
  useEffect(() => { generation.current++; inFlight.current = false; setBusy(false); setPreview(null); setError(false); return () => { generation.current++; }; }, [thread.id, candidates.join('\n')]);
  if (!candidates.length || !getDesktopApi()?.previewLegacyContext) return null;
  const act = async () => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(false); const gen = generation.current;
    try {
      const api = getDesktopApi()!;
      if (!preview) {
        // Persist every candidate before the first batch claim, including those beyond 100.
        const metadata={createdAt:thread.createdAt,updatedAt:thread.updatedAt,mode:thread.mode,starred:thread.starred,pinnedAt:thread.pinnedAt,gtdBucket:thread.gtdBucket,sidebar_work_folder:thread.sidebar_work_folder};
        for (let offset = 0; offset < candidates.length; offset += 100) await api.importLegacyThreadMetadata({ legacyThreadId: thread.id, ...(thread.title ? { title: thread.title } : {}), metadata,taskIds: candidates.slice(offset, offset + 100), operationId: crypto.randomUUID() });
        const next = await api.previewLegacyContext({ legacyThreadId: thread.id, ...(thread.title ? { title: thread.title } : {}), taskIds: candidates.slice(0, 100), operationId: crypto.randomUUID() });
        if (gen === generation.current) setPreview(next);
      } else {
        await api.claimLegacyContext({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: crypto.randomUUID() });
        if (gen === generation.current) { setPreview(null); onClaimed?.(); window.dispatchEvent(new Event('xiaok:legacy-claimed')); }
      }
    } catch { if (gen === generation.current) {setError(true);setPreview(null);} }
    finally { if (gen === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  return <aside className="mx-4 my-2 rounded-lg border border-[var(--c-border)] p-3 text-sm text-[var(--c-text-secondary)]" aria-label={l.legacyTitle}>
    <p>{l.legacyNotice(candidates.length)}</p>
    {preview && <><p className="my-2">{l.archiveUnknown}</p>{preview.sources.map(source => <p key={source.taskId} className="my-1 break-words">{source.preview || source.taskId}</p>)}</>}
    {error && <p role="alert">{l.legacyUnavailable}</p>}
    <button type="button" disabled={busy} onClick={() => void act()} className="mt-2 underline">{preview ? l.claimArchive : l.inspectLegacy}</button>
  </aside>;
}
