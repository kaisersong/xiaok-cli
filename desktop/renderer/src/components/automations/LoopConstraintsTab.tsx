import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, Sparkles, Wrench } from 'lucide-react';

import { useLocale } from '../../contexts/LocaleContext';
import { useToast } from '../../shared';
import { api } from '../../api';
import type { LearnedConstraintView, LoopDefinitionView } from '../../api/types';

type ConstraintFilter = 'active' | 'pending' | 'archived';

interface LoopConstraintsTabProps {
  highlightConstraintId?: string;
}

export function LoopConstraintsTab({ highlightConstraintId }: LoopConstraintsTabProps) {
  const { t, locale } = useLocale();
  const toast = useToast() as {
    addToast?: (message: string, type?: 'success' | 'error') => void;
    show?: (message: string, type?: 'success' | 'error') => void;
  };
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toast.addToast) toast.addToast(message, type);
    else toast.show?.(message, type);
  }, [toast]);

  const [definitions, setDefinitions] = useState<LoopDefinitionView[]>([]);
  const [constraints, setConstraints] = useState<LearnedConstraintView[]>([]);
  const [filter, setFilter] = useState<ConstraintFilter>('active');
  const [loopFilter, setLoopFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | undefined>(highlightConstraintId);

  const loadAll = useCallback(async () => {
    try {
      const defs = await api.getLoopDefinitions();
      setDefinitions(defs);
      const all: LearnedConstraintView[] = [];
      for (const def of defs) {
        try {
          const list = await api.listLoopConstraints(def.id);
          all.push(...list);
        } catch {
          // swallow per-loop failure to keep partial UI usable
        }
      }
      all.sort((a, b) => b.createdAt - a.createdAt);
      setConstraints(all);
    } catch {
      setConstraints([]);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const off = api.onLoopConstraintAdded((constraint) => {
      setHighlightedId(constraint.id);
      void loadAll();
    });
    return off;
  }, [loadAll]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(undefined), 6000);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  const loopTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const def of definitions) map.set(def.id, def.title);
    return map;
  }, [definitions]);

  const filtered = useMemo(() => {
    return constraints.filter((c) => {
      if (loopFilter && c.loopId !== loopFilter) return false;
      if (filter === 'active') {
        return c.active && !c.deactivationReason;
      }
      if (filter === 'pending') {
        return !c.active && !c.deactivationReason && !c.supersededBy;
      }
      return Boolean(c.deactivationReason) || Boolean(c.supersededBy);
    });
  }, [constraints, filter, loopFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, pending: 0, archived: 0 };
    for (const item of constraints) {
      if (loopFilter && item.loopId !== loopFilter) continue;
      if (item.active && !item.deactivationReason) c.active++;
      else if (!item.active && !item.deactivationReason && !item.supersededBy) c.pending++;
      else c.archived++;
    }
    return c;
  }, [constraints, loopFilter]);

  const handleConfirm = useCallback(async (constraint: LearnedConstraintView) => {
    setBusyId(constraint.id);
    try {
      await api.confirmLoopConstraint(constraint.id);
      showToast(t.automationsConstraintsToastConfirmed, 'success');
      await loadAll();
    } catch (e) {
      console.error('[LoopConstraintsTab] confirm failed', e);
      showToast(t.automationsConstraintsToastFailed, 'error');
    } finally {
      setBusyId(null);
    }
  }, [loadAll, showToast, t]);

  const handleToggleActive = useCallback(async (constraint: LearnedConstraintView, nextActive: boolean) => {
    setBusyId(constraint.id);
    try {
      await api.setLoopConstraintActive(constraint.id, nextActive);
      showToast(
        nextActive ? t.automationsConstraintsToastReactivated : t.automationsConstraintsToastDeactivated,
        'success'
      );
      await loadAll();
    } catch (e) {
      console.error('[LoopConstraintsTab] toggle failed', e);
      showToast(t.automationsConstraintsToastFailed, 'error');
    } finally {
      setBusyId(null);
    }
  }, [loadAll, showToast, t]);

  const formatTime = (ts: number) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return '';
    }
  };

  const sourceIcon = (source: LearnedConstraintView['source']) => {
    if (source === 'llm_extraction') return <Sparkles size={12} />;
    if (source === 'rule_extraction') return <Wrench size={12} />;
    return <CheckCircle2 size={12} />;
  };

  const sourceLabel = (source: LearnedConstraintView['source']) => {
    if (source === 'llm_extraction') return t.automationsConstraintsSourceLLM;
    if (source === 'rule_extraction') return t.automationsConstraintsSourceRule;
    return t.automationsConstraintsSourceManual;
  };

  const deactivationReasonLabel = (reason: string | null) => {
    if (!reason) return '';
    switch (reason) {
      case 'stale': return t.automationsConstraintsDeactivationReasonStale;
      case 'ineffective': return t.automationsConstraintsDeactivationReasonIneffective;
      case 'overflow': return t.automationsConstraintsDeactivationReasonOverflow;
      case 'superseded': return t.automationsConstraintsDeactivationReasonSuperseded;
      case 'user': return t.automationsConstraintsDeactivationReasonUser;
      default: return reason;
    }
  };

  const FILTERS: Array<{ key: ConstraintFilter; label: string; count: number }> = [
    { key: 'active', label: t.automationsConstraintsActive, count: counts.active },
    { key: 'pending', label: t.automationsConstraintsPending, count: counts.pending },
    { key: 'archived', label: t.automationsConstraintsArchived, count: counts.archived },
  ];

  return (
    <div className="space-y-4">
      <header className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--c-text-primary)]">{t.automationsConstraints}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{t.automationsConstraintsDesc}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.key
                ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white'
                : 'border-[var(--c-border)] bg-[var(--c-bg-card)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
            }`}
          >
            {f.label} <span className="ml-1 opacity-70">({f.count})</span>
          </button>
        ))}
        <select
          value={loopFilter}
          onChange={(e) => setLoopFilter(e.target.value)}
          className="ml-auto rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs text-[var(--c-text-primary)]"
        >
          <option value="">{t.automationsConstraintsLoopFilterAll}</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-8 text-center text-xs text-[var(--c-text-secondary)]">
          {t.automationsConstraintsEmpty}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => {
            const isHighlighted = highlightedId === c.id;
            const isPending = !c.active && !c.deactivationReason && !c.supersededBy;
            const isArchived = Boolean(c.deactivationReason || c.supersededBy);
            const loopTitle = loopTitleById.get(c.loopId) ?? c.loopId;
            return (
              <li
                key={c.id}
                className={`rounded-md border px-3 py-2 transition-colors ${
                  isHighlighted
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft,_rgba(56,_139,_253,_0.1))]'
                    : 'border-[var(--c-border)] bg-[var(--c-bg-card)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--c-text-tertiary)]">
                      <span className="inline-flex items-center gap-1 rounded bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[var(--c-text-secondary)]">
                        {sourceIcon(c.source)}
                        {sourceLabel(c.source)}
                      </span>
                      <span className="text-[var(--c-text-primary)]">{loopTitle}</span>
                      {isHighlighted && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          {t.automationsConstraintsNewBadge}
                        </span>
                      )}
                      {c.active && !isArchived && (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                          {t.automationsConstraintsActive}
                        </span>
                      )}
                      {isPending && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                          {t.automationsConstraintsPending}
                        </span>
                      )}
                      {isArchived && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                          {deactivationReasonLabel(c.deactivationReason ?? (c.supersededBy ? 'superseded' : null))}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 break-words text-sm text-[var(--c-text-primary)]">{c.rule}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-[var(--c-text-tertiary)]">
                      <span>{t.automationsConstraintsCreatedAt}: {formatTime(c.createdAt)}</span>
                      {c.hitCount > 0 && <span>{t.automationsConstraintsHits(c.hitCount)}</span>}
                      {c.failureKind && <span>{t.automationsConstraintsFromFailure}: {c.failureKind}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isPending && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void handleConfirm(c)}
                        className="rounded-md border border-[var(--c-accent)] bg-[var(--c-accent)] px-2 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {t.automationsConstraintsConfirm}
                      </button>
                    )}
                    {c.active && !isArchived && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void handleToggleActive(c, false)}
                        className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-[11px] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-60"
                      >
                        {t.automationsConstraintsDeactivate}
                      </button>
                    )}
                    {isArchived && c.deactivationReason !== 'superseded' && !c.supersededBy && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void handleToggleActive(c, true)}
                        className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-[11px] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-60"
                      >
                        {t.automationsConstraintsActivate}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
