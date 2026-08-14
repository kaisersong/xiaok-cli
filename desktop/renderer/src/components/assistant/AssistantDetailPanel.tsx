import { useState } from 'react';
import { Check, X } from 'lucide-react';

import { useLocale } from '../../contexts/LocaleContext';
import type {
  AssistantCandidateStatusView,
  AssistantCandidateView,
  AssistantProfileView,
} from './view-types';

export type { AssistantCandidateView } from './view-types';

export interface AssistantDetailPanelProps {
  open: boolean;
  profile: AssistantProfileView;
  candidates: AssistantCandidateView[];
  knowledgeCollections: Array<{ id: string; name: string }>;
  busyCandidateId?: string | null;
  onClose: () => void;
  onAcceptCandidate: (candidateId: string, collectionId?: string) => void | Promise<void>;
  onRejectCandidate: (candidateId: string) => void | Promise<void>;
}

export function AssistantDetailPanel({
  open,
  profile,
  candidates,
  knowledgeCollections,
  busyCandidateId = null,
  onClose,
  onAcceptCandidate,
  onRejectCandidate,
}: AssistantDetailPanelProps) {
  const { t } = useLocale();
  const [collectionByCandidate, setCollectionByCandidate] = useState<Record<string, string>>({});
  if (!open) return null;

  const statusLabel = (status: AssistantCandidateStatusView) => {
    const labels: Record<AssistantCandidateStatusView, string> = {
      staged: t.assistant.candidateStatusStaged,
      pending: t.assistant.candidateStatusPending,
      accepting: t.assistant.candidateStatusAccepting,
      accepted: t.assistant.candidateStatusAccepted,
      rejected: t.assistant.candidateStatusRejected,
      superseded: t.assistant.candidateStatusSuperseded,
      accept_failed: t.assistant.candidateStatusAcceptFailed,
    };
    return labels[status];
  };

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex justify-end bg-black/25" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-label={t.assistant.detailTitle} className="flex h-full w-full max-w-xl flex-col border-l border-[var(--c-border)] bg-[var(--c-bg-page)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--c-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--c-text-primary)]">{t.assistant.detailTitle}</h2>
            <p className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.assistant.detailSchedule(profile.eveningTime, profile.morningTime)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.assistant.closeDetails} className="rounded-md p-1.5 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">{t.assistant.candidatesTitle}</h3>
            <span className="text-xs text-[var(--c-text-tertiary)]">{t.assistant.candidateCount(candidates.length)}</span>
          </div>
          {candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--c-border)] px-4 py-10 text-center text-sm text-[var(--c-text-secondary)]">{t.assistant.noCandidates}</div>
          ) : (
            <div className="space-y-3">
              {candidates.map(candidate => {
                const canDecide = candidate.status === 'pending' || candidate.status === 'accept_failed';
                const busy = busyCandidateId === candidate.id || candidate.status === 'accepting';
                const selectedCollectionId = collectionByCandidate[candidate.id];
                const needsCollection = candidate.kind === 'knowledge';
                return (
                  <article key={candidate.id} className="rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-[var(--c-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-accent)]">{t.assistant.candidateKind(candidate.kind)}</span>
                          <span className="text-[10px] text-[var(--c-text-tertiary)]">{t.assistant.confidence(candidate.confidence)}</span>
                        </div>
                        <h4 className="mt-2 text-sm font-semibold text-[var(--c-text-primary)]">{candidate.title}</h4>
                      </div>
                      <span className="rounded bg-[var(--c-bg-deep)] px-2 py-1 text-[10px] text-[var(--c-text-secondary)]">{statusLabel(candidate.status)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--c-text-secondary)]">{candidate.content}</p>
                    {candidate.evidenceRefs.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {candidate.evidenceRefs.map(reference => (
                          <span key={`${reference.kind}:${reference.id}`} className="rounded-full border border-[var(--c-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--c-text-tertiary)]">
                            {t.assistant.evidence(reference.kind, reference.id)}
                          </span>
                        ))}
                      </div>
                    )}
                    {canDecide && (
                      <div className="mt-4 space-y-3">
                        {needsCollection && (
                          <label className="block text-xs text-[var(--c-text-secondary)]">
                            <span className="mb-1 block">{t.assistant.knowledgeCollection}</span>
                            <select
                              aria-label={t.assistant.knowledgeCollectionLabel(candidate.title)}
                              value={selectedCollectionId ?? ''}
                              onChange={event => setCollectionByCandidate(current => ({
                                ...current,
                                [candidate.id]: event.target.value,
                              }))}
                              className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2.5 py-2 text-xs text-[var(--c-text-primary)]"
                            >
                              <option value="">{t.assistant.selectKnowledgeCollection}</option>
                              {knowledgeCollections.map(collection => (
                                <option key={collection.id} value={collection.id}>{collection.name}</option>
                              ))}
                            </select>
                            {knowledgeCollections.length === 0 && (
                              <span className="mt-1 block text-[var(--c-text-tertiary)]">{t.assistant.noKnowledgeCollections}</span>
                            )}
                          </label>
                        )}
                        <div className="flex justify-end gap-2">
                        <button type="button" disabled={busy} aria-label={t.assistant.rejectCandidateLabel(candidate.title)} onClick={() => onRejectCandidate(candidate.id)} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-60">
                          {t.assistant.rejectCandidate}
                        </button>
                        <button type="button" disabled={busy || (needsCollection && !selectedCollectionId)} aria-label={t.assistant.acceptCandidateLabel(candidate.title)} onClick={() => needsCollection ? onAcceptCandidate(candidate.id, selectedCollectionId) : onAcceptCandidate(candidate.id)} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                          <Check size={13} />
                          {t.assistant.acceptCandidate}
                        </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
