/**
 * PrinciplesTab — project principles management tab embedded in ProjectsPage.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Plus, Download, Pencil, Trash2, BookOpen } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import { PrincipleEditModal } from './PrincipleEditModal';
import { ImportMemoryModal } from './ImportMemoryModal';
import type { PrincipleFormData } from './PrincipleEditModal';

type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';

interface ProjectPrinciple {
  id: string;
  content: string;
  scenarios: PrincipleScenario[];
  source: 'manual' | 'memory';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface QualityRuleView {
  id: string;
  description?: string;
  severity?: 'hard' | 'soft' | string;
}

interface QualityPackView {
  id: string;
  version?: number;
  source?: string;
  rules?: QualityRuleView[];
}

interface QualityConflictView {
  ruleId?: string;
  resolution?: string;
  chosenSeverity?: string;
}

interface QualityKnowledgeView {
  builtinPacks: QualityPackView[];
  userOverlays: QualityRuleView[];
  workspaceOverlays: QualityRuleView[];
  conflicts: QualityConflictView[];
}

export function PrinciplesTab({ addTrigger = 0, importTrigger = 0 }: { addTrigger?: number; importTrigger?: number }) {
  const { t } = useLocale();
  const [principles, setPrinciples] = useState<ProjectPrinciple[]>([]);
  const [qualityKnowledge, setQualityKnowledge] = useState<QualityKnowledgeView | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editingPrinciple, setEditingPrinciple] = useState<ProjectPrinciple | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadPrinciples = useCallback(async () => {
    try {
      const api = getDesktopApi() as any;
      if (!api?.listPrinciples) return;
      const list = await api.listPrinciples();
      setPrinciples(Array.isArray(list) ? list : []);
    } catch {
      setPrinciples([]);
    }
  }, []);

  const loadQualityKnowledge = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:4400/quality/knowledge');
      if (!res.ok) return;
      const data = await res.json();
      setQualityKnowledge({
        builtinPacks: Array.isArray(data?.builtinPacks) ? data.builtinPacks : [],
        userOverlays: Array.isArray(data?.userOverlays) ? data.userOverlays : [],
        workspaceOverlays: Array.isArray(data?.workspaceOverlays) ? data.workspaceOverlays : [],
        conflicts: Array.isArray(data?.conflicts) ? data.conflicts : [],
      });
    } catch {
      setQualityKnowledge(null);
    }
  }, []);

  useEffect(() => { loadPrinciples(); }, [loadPrinciples]);
  useEffect(() => { loadQualityKnowledge(); }, [loadQualityKnowledge]);

  useEffect(() => {
    if (addTrigger > 0) { setEditingPrinciple(null); setShowEdit(true); }
  }, [addTrigger]);

  useEffect(() => {
    if (importTrigger > 0) setShowImport(true);
  }, [importTrigger]);

  const handleSave = async (principle: PrincipleFormData) => {
    const api = getDesktopApi() as any;
    if (!api?.savePrinciple) return;
    await api.savePrinciple(principle);
    await loadPrinciples();
  };

  const handleDelete = async (id: string) => {
    const api = getDesktopApi() as any;
    if (!api?.deletePrinciple) return;
    await api.deletePrinciple(id);
    setConfirmDeleteId(null);
    await loadPrinciples();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const p = principles.find(x => x.id === id);
    if (!p) return;
    await handleSave({ ...p, enabled, updatedAt: Date.now() });
  };

  const handleImport = async (entries: Array<{ id: string; content: string }>) => {
    const api = getDesktopApi() as any;
    if (!api?.savePrinciple) return;
    const now = Date.now();
    for (const entry of entries) {
      const principle: ProjectPrinciple = {
        id: `prin_${now}_${Math.random().toString(36).slice(2, 8)}`,
        content: entry.content.slice(0, 500),
        scenarios: ['planning', 'execution', 'review', 'delivery'],
        source: 'memory',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      await api.savePrinciple(principle);
    }
    await loadPrinciples();
  };

  const openEdit = (p?: ProjectPrinciple) => {
    setEditingPrinciple(p || null);
    setShowEdit(true);
  };

  const scenarioLabel = (s: PrincipleScenario) => {
    switch (s) {
      case 'planning': return t.projectsPrinciplesScenarioPlanning;
      case 'execution': return t.projectsPrinciplesScenarioExecution;
      case 'review': return t.projectsPrinciplesScenarioReview;
      case 'delivery': return t.projectsPrinciplesScenarioDelivery;
    }
  };

  const hasQualityKnowledge = Boolean(
    qualityKnowledge &&
    (
      qualityKnowledge.builtinPacks.length > 0 ||
      qualityKnowledge.userOverlays.length > 0 ||
      qualityKnowledge.workspaceOverlays.length > 0 ||
      qualityKnowledge.conflicts.length > 0
    )
  );

  const renderRulePill = (rule: QualityRuleView) => (
    <div key={rule.id} className="rounded-md border border-[var(--c-border-subtle)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-xs font-medium text-[var(--c-text-primary)]">{rule.description || rule.id}</p>
        {rule.severity && (
          <span className="shrink-0 rounded-md bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--c-text-muted)]">
            {rule.severity}
          </span>
        )}
      </div>
      {rule.description && <p className="mt-1 break-words text-[10px] text-[var(--c-text-muted)]">{rule.id}</p>}
    </div>
  );

  const renderSection = (title: string, children: ReactNode, action?: ReactNode) => (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );

  const renderPrincipleList = () => (
    <div className="space-y-3">
      {principles.map(p => (
        <div
          key={p.id}
          data-disabled={!p.enabled || undefined}
          className={`group rounded-lg border border-[var(--c-border-subtle)] px-4 py-3 transition-colors ${!p.enabled ? 'opacity-50' : ''}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className={`text-sm text-[var(--c-text-primary)] ${!p.enabled ? 'line-through' : ''}`}>
                {p.content}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.scenarios.map(s => (
                  <span
                    key={s}
                    className="rounded-md bg-[var(--c-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-accent)]"
                  >
                    {scenarioLabel(s)}
                  </span>
                ))}
                <span className="ml-2 text-[10px] text-[var(--c-text-muted)]">
                  {p.source === 'memory' ? t.projectsPrinciplesSourceMemory : t.projectsPrinciplesSourceManual}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={e => handleToggle(p.id, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
                title={p.enabled ? t.projectsPrinciplesEnabled : t.projectsPrinciplesDisabled}
              />
              <button
                type="button"
                onClick={() => openEdit(p)}
                className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]"
                title={t.projectsPrinciplesEdit}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(p.id)}
                className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-status-error-text)]"
                title={t.projectsPrinciplesDelete}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const myKnowledgeAction = (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => openEdit()}
        className="flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
      >
        <Plus size={13} />
        <span>{t.projectsPrinciplesAdd}</span>
      </button>
      <button
        type="button"
        onClick={() => setShowImport(true)}
        className="flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
      >
        <Download size={13} />
        <span>{t.projectsPrinciplesImportMemory}</span>
      </button>
    </div>
  );

  if (principles.length === 0 && !hasQualityKnowledge) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--c-bg-deep)]">
            <BookOpen size={28} className="text-[var(--c-text-secondary)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--c-text-primary)]">{t.projectsPrinciplesEmpty}</p>
            <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{t.projectsPrinciplesEmptyDesc}</p>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => openEdit()}
              className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              <Plus size={15} />
              <span>{t.projectsPrinciplesAdd}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              <Download size={15} />
              <span>{t.projectsPrinciplesImportMemory}</span>
            </button>
          </div>
        </div>

        <PrincipleEditModal open={showEdit} principle={editingPrinciple} onClose={() => setShowEdit(false)} onSave={handleSave} />
        <ImportMemoryModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
      </>
    );
  }

  return (
    <>
      <div className="p-6">
        <div className="space-y-6">
          {qualityKnowledge && renderSection(
            t.projectsKnowledgeBuiltin,
            <div className="grid gap-2 md:grid-cols-2">
              {qualityKnowledge.builtinPacks.map(pack => (
                <div key={pack.id} className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--c-text-primary)]">{pack.id}</p>
                    <span className="rounded-md bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
                      {t.projectsKnowledgeReadOnly}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--c-text-muted)]">
                    {pack.source || 'builtin'}@{pack.version || 1} · {pack.rules?.length || 0} rules
                  </p>
                </div>
              ))}
            </div>,
          )}

          {renderSection(
            t.projectsKnowledgeMine,
            <div className="space-y-3">
              {principles.length > 0 ? renderPrincipleList() : (
                <p className="rounded-lg border border-dashed border-[var(--c-border-subtle)] px-4 py-3 text-xs text-[var(--c-text-muted)]">
                  {t.projectsPrinciplesEmpty}
                </p>
              )}
              {qualityKnowledge?.userOverlays.map(renderRulePill)}
            </div>,
            myKnowledgeAction,
          )}

          {qualityKnowledge && renderSection(
            t.projectsKnowledgeWorkspace,
            <div className="space-y-2">
              {qualityKnowledge.workspaceOverlays.length > 0
                ? qualityKnowledge.workspaceOverlays.map(renderRulePill)
                : <p className="text-xs text-[var(--c-text-muted)]">{t.projectsPrinciplesImportEmpty}</p>}
            </div>,
          )}

          {qualityKnowledge && renderSection(
            t.projectsKnowledgeConflicts,
            <div className="space-y-2">
              {qualityKnowledge.conflicts.length > 0 ? qualityKnowledge.conflicts.map(conflict => (
                <div key={`${conflict.ruleId}-${conflict.resolution}`} className="rounded-md border border-[var(--c-border-subtle)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--c-text-primary)]">{conflict.ruleId}</p>
                  <p className="mt-1 text-[10px] text-[var(--c-text-muted)]">
                    {conflict.resolution || 'resolved'} · {conflict.chosenSeverity || ''}
                  </p>
                </div>
              )) : <p className="text-xs text-[var(--c-text-muted)]">{t.projectsKnowledgeNoConflicts}</p>}
            </div>,
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-[var(--c-text-primary)]">{t.projectsPrinciplesDeleteConfirm}</h4>
            <p className="mt-2 text-xs text-[var(--c-text-secondary)]">{t.projectsPrinciplesDeleteConfirmBody}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-[var(--c-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                {t.projectsPrinciplesDeleteCancel}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white hover:brightness-[1.1]"
                style={{ backgroundColor: 'var(--c-status-error-text)' }}
              >
                {t.projectsPrinciplesDelete}
              </button>
            </div>
          </div>
        </div>
      )}

      <PrincipleEditModal open={showEdit} principle={editingPrinciple} onClose={() => setShowEdit(false)} onSave={handleSave} />
      <ImportMemoryModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
    </>
  );
}
