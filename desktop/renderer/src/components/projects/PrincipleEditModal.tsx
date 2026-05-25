/**
 * PrincipleEditModal — add or edit project knowledge, or add a concrete quality rule.
 */

import { useEffect, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';
type EditMode = 'knowledge' | 'rule';

export interface PrincipleFormData {
  id: string;
  content: string;
  scenarios: PrincipleScenario[];
  source: 'manual' | 'memory';
  kind?: 'knowledge' | 'rule';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RuleFormData {
  id: string;
  packId: string;
  severity: 'hard' | 'soft';
  appliesTo: PrincipleScenario[];
  description: string;
  promptExcerpt: { po: string; worker: string };
  enabled: boolean;
}

interface Props {
  open: boolean;
  principle?: PrincipleFormData | null;
  initialMode?: EditMode;
  onClose(): void;
  onSave(principle: PrincipleFormData): Promise<void>;
  onSaveRule?(rule: RuleFormData): Promise<void>;
}

const SCENARIOS: PrincipleScenario[] = ['planning', 'execution', 'review', 'delivery'];
const KNOWLEDGE_LIMIT = 4000;
const RULE_LIMIT = 500;

export function PrincipleEditModal({ open, principle, initialMode = 'knowledge', onClose, onSave, onSaveRule }: Props) {
  const { t } = useLocale();
  const isEditingKnowledge = Boolean(principle);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<EditMode>(initialMode);
  const [content, setContent] = useState('');
  const [scenarios, setScenarios] = useState<PrincipleScenario[]>([...SCENARIOS]);
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState<'hard' | 'soft'>('hard');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (principle) {
      setMode('knowledge');
      setContent(principle.content);
      setScenarios([...principle.scenarios]);
      setEnabled(principle.enabled);
      setSeverity('hard');
      return;
    }
    setMode(initialMode);
    setContent('');
    setScenarios([...SCENARIOS]);
    setEnabled(true);
    setSeverity('hard');
  }, [open, principle, initialMode]);

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
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s],
    );
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setContent(text.slice(0, KNOWLEDGE_LIMIT));
  };

  const handleSubmit = async () => {
    if (!content.trim() || scenarios.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const now = Date.now();
      if (mode === 'rule' && !isEditingKnowledge) {
        if (!onSaveRule) return;
        const description = content.trim();
        await onSaveRule({
          id: `global.manual.${now}`,
          packId: 'global',
          severity,
          appliesTo: scenarios,
          description,
          promptExcerpt: {
            po: `Check this project rule: ${description}`,
            worker: `Follow this project rule: ${description}`,
          },
          enabled,
        });
      } else {
        await onSave({
          id: principle?.id || `prin_${now}_${Math.random().toString(36).slice(2, 8)}`,
          content: content.trim(),
          scenarios,
          source: principle?.source || 'manual',
          enabled,
          createdAt: principle?.createdAt || now,
          updatedAt: now,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projectsKnowledgeSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const limit = mode === 'rule' ? RULE_LIMIT : KNOWLEDGE_LIMIT;
  const contentOverLimit = content.length > limit;
  const canSwitchMode = !isEditingKnowledge;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <div
        data-testid="knowledge-rule-modal"
        className="relative w-full max-w-xl rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-6 shadow-xl"
        style={{ background: 'var(--c-bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--c-text-primary)]">
            {isEditingKnowledge ? t.projectsPrinciplesEditTitle : mode === 'rule' ? t.projectsRuleAdd : t.projectsKnowledgeAdd}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <X size={16} />
          </button>
        </div>

        {canSwitchMode && (
          <div className="mb-4 inline-flex rounded-lg bg-[var(--c-bg-deep)] p-1">
            <button
              type="button"
              onClick={() => setMode('knowledge')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === 'knowledge' ? 'bg-[var(--c-bg-card)] text-[var(--c-text-primary)] shadow-sm' : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'}`}
              style={mode === 'knowledge' ? { background: 'var(--c-bg-card)' } : undefined}
            >
              {t.projectsKnowledgeCreateTab}
            </button>
            <button
              type="button"
              onClick={() => setMode('rule')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === 'rule' ? 'bg-[var(--c-bg-card)] text-[var(--c-text-primary)] shadow-sm' : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'}`}
              style={mode === 'rule' ? { background: 'var(--c-bg-card)' } : undefined}
            >
              {t.projectsRuleCreateTab}
            </button>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className="block text-xs font-medium text-[var(--c-text-secondary)]">
                {mode === 'rule' ? t.projectsRuleItemLabel : t.projectsKnowledgeDocumentLabel}
              </label>
              {mode === 'knowledge' && !isEditingKnowledge && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    className="hidden"
                    onChange={event => handleFileUpload(event.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border-subtle)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                  >
                    <FileUp size={13} />
                    <span>{t.projectsKnowledgeUpload}</span>
                  </button>
                </>
              )}
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={mode === 'rule' ? t.projectsRuleContentPlaceholder : t.projectsPrinciplesEditContentPlaceholder}
              rows={mode === 'rule' ? 4 : 7}
              className={`w-full resize-none rounded-lg border ${contentOverLimit ? 'border-[var(--c-status-error-text)]' : 'border-[var(--c-border-subtle)]'} bg-[var(--c-bg-card)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]`}
              style={{ background: 'var(--c-bg-card)' }}
            />
            <div className="mt-1 flex justify-between text-[10px] text-[var(--c-text-muted)]">
              {contentOverLimit && (
                <span className="text-[var(--c-status-error-text)]">
                  {mode === 'rule' ? t.projectsRuleContentTooLong : t.projectsPrinciplesContentTooLong}
                </span>
              )}
              <span className="ml-auto">{content.length}/{limit}</span>
            </div>
          </div>

          {mode === 'rule' && !isEditingKnowledge && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
                {t.projectsRuleSeverity}
              </label>
              <div className="inline-flex rounded-lg bg-[var(--c-bg-deep)] p-1">
                {(['hard', 'soft'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSeverity(value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${severity === value ? 'bg-[var(--c-bg-card)] text-[var(--c-text-primary)] shadow-sm' : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'}`}
                    style={severity === value ? { background: 'var(--c-bg-card)' } : undefined}
                  >
                    {value === 'hard' ? t.projectsRuleSeverityHard : t.projectsRuleSeveritySoft}
                  </button>
                ))}
              </div>
            </div>
          )}

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

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
            />
            <span className="text-xs text-[var(--c-text-secondary)]">{t.projectsPrinciplesEditEnabled}</span>
          </label>

          {error && <p className="text-xs text-[var(--c-status-error-text)]">{error}</p>}
        </div>

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
            className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] disabled:pointer-events-none disabled:opacity-50"
          >
            {t.projectsPrinciplesEditSave}
          </button>
        </div>
      </div>
    </div>
  );
}
