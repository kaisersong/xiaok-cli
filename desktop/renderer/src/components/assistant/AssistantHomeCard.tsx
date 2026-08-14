import { ArrowRight, CirclePause, Sparkles } from 'lucide-react';

import { useLocale } from '../../contexts/LocaleContext';
import type { AssistantHomeSnapshot } from './view-types';

export type { AssistantHomeSnapshot, AssistantSuggestionView } from './view-types';

export interface AssistantHomeCardProps {
  snapshot: AssistantHomeSnapshot | null;
  loadState?: 'loading' | 'ready' | 'unavailable';
  busy?: boolean;
  onActivate: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onOpenDetails: () => void;
}

export function AssistantHomeCard({
  snapshot,
  loadState = snapshot ? 'ready' : 'loading',
  busy = false,
  onActivate,
  onPause,
  onResume,
  onOpenDetails,
}: AssistantHomeCardProps) {
  const { t } = useLocale();

  if (!snapshot) {
    return (
      <section className="w-full rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)]/70 px-4 py-3" aria-labelledby="assistant-home-title">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--c-accent)]/10 text-[var(--c-accent)]">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <h2 id="assistant-home-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.assistant.title}</h2>
            <p className="mt-0.5 text-xs text-[var(--c-text-secondary)]">
              {loadState === 'unavailable' ? t.assistant.unavailable : t.assistant.loading}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const suggestions = snapshot.suggestions.slice(0, 3);
  const status = snapshot.profile.status;

  return (
    <section className="w-full rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)]/70 px-4 py-3" aria-labelledby="assistant-home-title">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--c-accent)]/10 text-[var(--c-accent)]">
          <Sparkles size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="assistant-home-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.assistant.title}</h2>
              <p className="mt-0.5 text-xs text-[var(--c-text-secondary)]">
                {status === 'needs_consent' && t.assistant.consentDescription}
                {status === 'active' && t.assistant.activeDescription(snapshot.profile.eveningTime, snapshot.profile.morningTime)}
                {status === 'paused' && t.assistant.pausedDescription}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status === 'needs_consent' && (
                <button type="button" disabled={busy} onClick={onActivate} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                  {t.assistant.activate}
                </button>
              )}
              {status === 'active' && (
                <button type="button" disabled={busy} onClick={onPause} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-60">
                  <CirclePause size={13} />
                  {t.assistant.pause}
                </button>
              )}
              {status === 'paused' && (
                <button type="button" disabled={busy} onClick={onResume} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                  {t.assistant.resume}
                </button>
              )}
            </div>
          </div>

          {status === 'paused' && <p className="mt-3 text-xs font-medium text-[var(--c-text-primary)]">{t.assistant.pausedTitle}</p>}

          {status === 'active' && (
            <div className="mt-3">
              {suggestions.length > 0 ? (
                <ol className="space-y-2">
                  {suggestions.map(suggestion => (
                    <li key={suggestion.id} className="flex gap-2 text-xs">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--c-accent)]" />
                      <span className="min-w-0">
                        <span className="block font-medium text-[var(--c-text-primary)]">{suggestion.title}</span>
                        <span className="mt-0.5 block text-[var(--c-text-secondary)]">{suggestion.summary}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-[var(--c-text-secondary)]">{t.assistant.noSuggestions}</p>
              )}
            </div>
          )}

          {status !== 'needs_consent' && (
            <div className="mt-3 flex items-center justify-between border-t border-[var(--c-border-subtle)] pt-2">
              <span className="text-[11px] text-[var(--c-text-tertiary)]">{t.assistant.pendingCandidates(snapshot.pendingCandidateCount)}</span>
              <button type="button" onClick={onOpenDetails} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--c-accent)] hover:underline">
                {t.assistant.openDetails}
                <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
