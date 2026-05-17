/**
 * PrincipleEditModal — add or edit a project principle.
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';

export interface PrincipleFormData {
  id: string;
  content: string;
  scenarios: PrincipleScenario[];
  source: 'manual' | 'memory';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface Props {
  open: boolean;
  principle?: PrincipleFormData | null;
  onClose(): void;
  onSave(principle: PrincipleFormData): Promise<void>;
}

const SCENARIOS: PrincipleScenario[] = ['planning', 'execution', 'review', 'delivery'];

export function PrincipleEditModal({ open, principle, onClose, onSave }: Props) {
  const { t } = useLocale();
  const isNew = !principle;

  const [content, setContent] = useState('');
  const [scenarios, setScenarios] = useState<PrincipleScenario[]>([...SCENARIOS]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (principle) {
        setContent(principle.content);
        setScenarios([...principle.scenarios]);
        setEnabled(principle.enabled);
      } else {
        setContent('');
        setScenarios([...SCENARIOS]);
        setEnabled(true);
      }
    }
  }, [open, principle]);

  const scenarioLabel = (s: PrincipleScenario) => {
    switch (s) {
      case 'planning': return t.projectsPrinciplesScenarioPlanning;
      case 'execution': return t.projectsPrinciplesScenarioExecution;
      case 'review': return t.projectsPrinciplesScenarioReview;
      case 'delivery': return t.projectsPrinciplesScenarioDelivery;
    }
  };

  const toggleScenario = (s: PrincipleScenario) => {
    setScenarios(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const handleSubmit = async () => {
    if (!content.trim() || scenarios.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      await onSave({
        id: principle?.id || `prin_${now}_${Math.random().toString(36).slice(2, 8)}`,
        content: content.trim(),
        scenarios,
        source: principle?.source || 'manual',
        enabled,
        createdAt: principle?.createdAt || now,
        updatedAt: now,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const contentOverLimit = content.length > 500;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-primary)] p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--c-text-primary)]">
            {isNew ? t.projectsPrinciplesEditTitleNew : t.projectsPrinciplesEditTitle}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--c-text-secondary)]">
              {t.projectsPrinciplesEditContent}
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={t.projectsPrinciplesEditContentPlaceholder}
              rows={4}
              className={`w-full resize-none rounded-lg border ${contentOverLimit ? 'border-[var(--c-status-error-text)]' : 'border-[var(--c-border-subtle)]'} bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]`}
            />
            <div className="mt-1 flex justify-between text-[10px] text-[var(--c-text-muted)]">
              {contentOverLimit && (
                <span className="text-[var(--c-status-error-text)]">{t.projectsPrinciplesContentTooLong}</span>
              )}
              <span className="ml-auto">{content.length}/500</span>
            </div>
          </div>

          {/* Scenarios */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
              {t.projectsPrinciplesEditScenarios}
            </label>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScenario(s)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    scenarios.includes(s)
                      ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                      : 'border-[var(--c-border-subtle)] text-[var(--c-text-muted)] hover:border-[var(--c-text-tertiary)]'
                  }`}
                >
                  {scenarioLabel(s)}
                </button>
              ))}
            </div>
            {scenarios.length === 0 && (
              <p className="mt-1 text-[10px] text-[var(--c-status-error-text)]">{t.projectsPrinciplesEditScenariosHint}</p>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
            />
            <span className="text-xs text-[var(--c-text-secondary)]">{t.projectsPrinciplesEditEnabled}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
          >
            {t.projectsPrinciplesEditCancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || scenarios.length === 0 || contentOverLimit || saving}
            className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] disabled:opacity-50 disabled:pointer-events-none"
          >
            {t.projectsPrinciplesEditSave}
          </button>
        </div>
      </div>
    </div>
  );
}
