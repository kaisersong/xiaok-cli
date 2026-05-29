/**
 * PrinciplesTab — project knowledge documents and concrete quality rules.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Download, Eye, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import { PrincipleEditModal } from './PrincipleEditModal';
import { ImportMemoryModal } from './ImportMemoryModal';
import type { PrincipleFormData, RuleFormData } from './PrincipleEditModal';

type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';
type MainTab = 'knowledge' | 'rules';

interface ProjectPrinciple {
  id: string;
  content: string;
  scenarios: PrincipleScenario[];
  source: 'manual' | 'memory';
  kind?: 'knowledge' | 'rule';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface KnowledgeDocumentView {
  id: string;
  packId?: string;
  title?: string;
  source?: string;
  version?: number;
  content: string;
  rules?: string[];
  readOnly?: boolean;
  principle?: ProjectPrinciple;
}

interface QualityRuleView {
  id: string;
  packId?: string;
  description?: string;
  severity?: 'hard' | 'soft' | string;
  appliesTo?: string[];
  metadata?: Record<string, unknown>;
}

interface QualityPackView {
  id: string;
  version?: number;
  source?: string;
  rules?: QualityRuleView[];
  knowledgeDocuments?: KnowledgeDocumentView[];
}

interface QualityConflictView {
  ruleId?: string;
  resolution?: string;
  chosenSeverity?: string;
}

interface QualityKnowledgeView {
  knowledgeDocuments: KnowledgeDocumentView[];
  builtinPacks: QualityPackView[];
  userOverlays: QualityRuleView[];
  workspaceOverlays: QualityRuleView[];
  conflicts: QualityConflictView[];
}

interface ExtractionState {
  doc: KnowledgeDocumentView;
  status: 'loading' | 'ready' | 'saved' | 'error';
  rules: QualityRuleView[];
  patch: Record<string, unknown> | null;
  error?: string;
}

const QUALITY_BASE_URL = 'http://127.0.0.1:4400';

export function PrinciplesTab({ addTrigger = 0, importTrigger = 0 }: { addTrigger?: number; importTrigger?: number }) {
  const { t } = useLocale();
  const [principles, setPrinciples] = useState<ProjectPrinciple[]>([]);
  const [qualityKnowledge, setQualityKnowledge] = useState<QualityKnowledgeView | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('knowledge');
  const [showEdit, setShowEdit] = useState(false);
  const [editMode, setEditMode] = useState<'knowledge' | 'rule'>('knowledge');
  const [editingPrinciple, setEditingPrinciple] = useState<ProjectPrinciple | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocumentView | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);

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
      const res = await fetch(`${QUALITY_BASE_URL}/quality/knowledge`);
      if (!res.ok) return;
      const data = await res.json();
      const builtinPacks = Array.isArray(data?.builtinPacks) ? data.builtinPacks : [];
      setQualityKnowledge({
        knowledgeDocuments: normalizeKnowledgeDocuments(data?.knowledgeDocuments, builtinPacks),
        builtinPacks,
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
    if (addTrigger > 0) openEdit(undefined, 'knowledge');
  }, [addTrigger]);

  useEffect(() => {
    if (importTrigger > 0) setShowImport(true);
  }, [importTrigger]);

  const manualKnowledgeDocs = useMemo(() => principles
    .filter(p => !p.kind || p.kind === 'knowledge')
    .map(principle => ({
      id: principle.id,
      title: deriveKnowledgeTitle(principle.content),
      source: principle.source,
      content: principle.content,
      readOnly: false,
      principle,
    } satisfies KnowledgeDocumentView)), [principles]);

  const manualRulePrinciples = useMemo(() =>
    principles.filter(p => p.kind === 'rule'),
    [principles]);

  const builtinKnowledgeDocs = qualityKnowledge?.knowledgeDocuments || [];
  const builtinRuleCount = qualityKnowledge?.builtinPacks.reduce((count, pack) => count + (pack.rules?.length || 0), 0) || 0;
  const hasKnowledge = builtinKnowledgeDocs.length > 0 || manualKnowledgeDocs.length > 0;
  const hasRules = builtinRuleCount > 0
    || Boolean(qualityKnowledge?.userOverlays.length)
    || Boolean(qualityKnowledge?.workspaceOverlays.length)
    || Boolean(qualityKnowledge?.conflicts.length)
    || manualRulePrinciples.length > 0;

  const handleSaveKnowledge = async (principle: PrincipleFormData) => {
    const api = getDesktopApi() as any;
    if (!api?.savePrinciple) return;
    const result = await api.savePrinciple(principle);
    if (result?.success === false) throw new Error(result.error || t.projectsKnowledgeSaveFailed);
    await loadPrinciples();
  };

  const handleSaveRule = async (rule: RuleFormData) => {
    const now = Date.now();
    const patch = {
      patchId: `qmanual-${now}`,
      initiatedBy: 'user',
      confirmedBy: 'user',
      trustedInput: true,
      target: 'user_knowledge_overlay',
      affectedPacks: ['global'],
      createdAt: new Date(now).toISOString(),
      compilerVersion: 'quality-rules@1',
      operations: [
        {
          op: 'upsert_rule',
          rule: {
            ...rule,
            metadata: { kind: 'manual_rule' },
          },
        },
      ],
    };
    await postQuality('/quality/patches/apply', { patch });
    await loadQualityKnowledge();
    setActiveTab('rules');
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
    await handleSaveKnowledge({ ...p, enabled, updatedAt: Date.now() });
  };

  const handleReclassify = async (id: string, kind: 'knowledge' | 'rule') => {
    const api = getDesktopApi() as any;
    if (!api?.savePrinciple) return;
    const p = principles.find(x => x.id === id);
    if (!p) return;
    await api.savePrinciple({ ...p, kind, updatedAt: Date.now() });
    await loadPrinciples();
  };

  const handleImport = async (entries: Array<{ id: string; content: string }>) => {
    const api = getDesktopApi() as any;
    if (!api?.savePrinciple) return;
    const now = Date.now();
    for (const entry of entries) {
      const principle: ProjectPrinciple = {
        id: `prin_${now}_${Math.random().toString(36).slice(2, 8)}`,
        content: entry.content.slice(0, 4000),
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

  const openEdit = (principle?: ProjectPrinciple, mode: 'knowledge' | 'rule' = 'knowledge') => {
    setEditingPrinciple(principle || null);
    setEditMode(principle ? 'knowledge' : mode);
    setShowEdit(true);
  };

  const handleExtractRules = async (doc: KnowledgeDocumentView) => {
    setExtraction({ doc, status: 'loading', rules: [], patch: null });
    try {
      const result = await postQuality('/quality/rules/extract', {
        knowledgeId: doc.id,
        title: doc.title || doc.id,
        content: doc.content,
        appliesTo: ['review'],
      });
      setExtraction({
        doc,
        status: 'ready',
        rules: Array.isArray(result?.rules) ? result.rules : [],
        patch: result?.patch || null,
      });
    } catch (err) {
      setExtraction({
        doc,
        status: 'error',
        rules: [],
        patch: null,
        error: err instanceof Error ? err.message : t.projectsKnowledgeExtractFailed,
      });
    }
  };

  const handleSaveExtractedRules = async () => {
    if (!extraction?.patch) return;
    setExtraction(prev => prev ? { ...prev, status: 'loading' } : prev);
    try {
      await postQuality('/quality/patches/apply', { patch: extraction.patch });
      await loadQualityKnowledge();
      setActiveTab('rules');
      setExtraction(prev => prev ? { ...prev, status: 'saved' } : prev);
    } catch (err) {
      setExtraction(prev => prev ? {
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : t.projectsKnowledgeSaveFailed,
      } : prev);
    }
  };

  if (!hasKnowledge && !hasRules) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-xl bg-[var(--c-bg-deep)]">
            <BookOpen size={28} className="text-[var(--c-text-secondary)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--c-text-primary)]">{t.projectsPrinciplesEmpty}</p>
            <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{t.projectsPrinciplesEmptyDesc}</p>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => openEdit(undefined, 'knowledge')}
              className="inline-flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
            >
              <Plus size={15} />
              <span>{t.projectsKnowledgeAdd}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
            >
              <Download size={15} />
              <span>{t.projectsPrinciplesImportMemory}</span>
            </button>
          </div>
        </div>

        <PrincipleEditModal open={showEdit} principle={editingPrinciple} initialMode={editMode} onClose={() => setShowEdit(false)} onSave={handleSaveKnowledge} onSaveRule={handleSaveRule} />
        <ImportMemoryModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
      </>
    );
  }

  return (
    <>
      <div className="p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-[var(--c-bg-deep)] p-1">
            {(['knowledge', 'rules'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeTab === tab ? 'bg-[var(--c-bg-card)] text-[var(--c-text-primary)] shadow-sm' : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'}`}
                style={activeTab === tab ? { background: 'var(--c-bg-card)' } : undefined}
              >
                {tab === 'knowledge' ? t.projectsKnowledgeTab : t.projectsRulesTab}
              </button>
            ))}
          </div>

          {activeTab === 'knowledge' ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => openEdit(undefined, 'knowledge')}
                className="inline-flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                <Plus size={13} />
                <span>{t.projectsKnowledgeAdd}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                <Download size={13} />
                <span>{t.projectsPrinciplesImportMemory}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openEdit(undefined, 'rule')}
              className="inline-flex items-center gap-1 rounded-md border-[0.5px] border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
            >
              <Plus size={13} />
              <span>{t.projectsRuleAdd}</span>
            </button>
          )}
        </div>

        {activeTab === 'knowledge' ? renderKnowledgeTab() : renderRulesTab()}
      </div>

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmDeleteId(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
          <div
            className="relative w-full max-w-sm rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-5 shadow-xl"
            style={{ background: 'var(--c-bg-card)' }}
            onClick={e => e.stopPropagation()}
          >
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

      {selectedDoc && renderKnowledgeDocumentModal(selectedDoc)}
      {extraction && renderExtractionModal(extraction)}

      <PrincipleEditModal open={showEdit} principle={editingPrinciple} initialMode={editMode} onClose={() => setShowEdit(false)} onSave={handleSaveKnowledge} onSaveRule={handleSaveRule} />
      <ImportMemoryModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
    </>
  );

  function renderKnowledgeTab() {
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsKnowledgeDefault}</h3>
          {builtinKnowledgeDocs.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {builtinKnowledgeDocs.map(doc => renderKnowledgeCard(doc, true))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--c-border-subtle)] px-4 py-3 text-xs text-[var(--c-text-muted)]">
              {t.projectsPrinciplesImportEmpty}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsKnowledgeMine}</h3>
          {manualKnowledgeDocs.length > 0 ? (
            <div className="space-y-3">
              {manualKnowledgeDocs.map(doc => renderKnowledgeCard(doc, false))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--c-border-subtle)] px-4 py-3 text-xs text-[var(--c-text-muted)]">
              {t.projectsPrinciplesEmpty}
            </p>
          )}
        </section>
      </div>
    );
  }

  function renderRulesTab() {
    return (
      <div className="space-y-6">
        {qualityKnowledge && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsRulesBuiltin}</h3>
            <div className="space-y-3">
              {qualityKnowledge.builtinPacks.map(pack => (
                <div key={pack.id} className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--c-text-primary)]">{pack.id}</p>
                    <span className="rounded-md bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
                      {t.projectsKnowledgeReadOnly}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(pack.rules || []).map(renderRulePill)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {(qualityKnowledge || manualRulePrinciples.length > 0) && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsRulesMine}</h3>
            <div className="space-y-2">
              {manualRulePrinciples.map(p => (
                <div key={p.id} className="rounded-md border border-[var(--c-border-subtle)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-xs font-medium text-[var(--c-text-primary)]">{p.content}</p>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(p.id)}
                      className="shrink-0 rounded p-0.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-status-error-text)]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {p.source === 'memory' && (
                    <span className="mt-1 inline-block text-[10px] text-[var(--c-text-muted)]">memory</span>
                  )}
                </div>
              ))}
              {qualityKnowledge && qualityKnowledge.userOverlays.map(renderRulePill)}
              {manualRulePrinciples.length === 0 && (!qualityKnowledge || qualityKnowledge.userOverlays.length === 0) && (
                <p className="rounded-lg border border-dashed border-[var(--c-border-subtle)] px-4 py-3 text-xs text-[var(--c-text-muted)]">{t.projectsPrinciplesImportEmpty}</p>
              )}
            </div>
          </section>
        )}

        {qualityKnowledge && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsRulesWorkspace}</h3>
            <div className="space-y-2">
              {qualityKnowledge.workspaceOverlays.length > 0
                ? qualityKnowledge.workspaceOverlays.map(renderRulePill)
                : <p className="text-xs text-[var(--c-text-muted)]">{t.projectsPrinciplesImportEmpty}</p>}
            </div>
          </section>
        )}

        {qualityKnowledge && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{t.projectsKnowledgeConflicts}</h3>
            <div className="space-y-2">
              {qualityKnowledge.conflicts.length > 0 ? qualityKnowledge.conflicts.map(conflict => (
                <div key={`${conflict.ruleId}-${conflict.resolution}`} className="rounded-md border border-[var(--c-border-subtle)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--c-text-primary)]">{conflict.ruleId}</p>
                  <p className="mt-1 text-[10px] text-[var(--c-text-muted)]">
                    {conflict.resolution || 'resolved'} · {conflict.chosenSeverity || ''}
                  </p>
                </div>
              )) : <p className="text-xs text-[var(--c-text-muted)]">{t.projectsKnowledgeNoConflicts}</p>}
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderKnowledgeCard(doc: KnowledgeDocumentView, builtin: boolean) {
    const principle = doc.principle;
    return (
      <div
        key={doc.id}
        data-disabled={principle && !principle.enabled ? true : undefined}
        className={`group rounded-lg border border-[var(--c-border-subtle)] px-4 py-3 transition-colors ${principle && !principle.enabled ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 break-words text-sm font-medium text-[var(--c-text-primary)]">{doc.title || doc.id}</p>
              {builtin && (
                <span className="rounded-md bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
                  {t.projectsKnowledgeReadOnly}
                </span>
              )}
            </div>
            {doc.content !== (doc.title || doc.id) && (
              <p className="mt-1 line-clamp-2 break-words text-xs text-[var(--c-text-secondary)]">{doc.content}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {principle?.scenarios.map(s => (
                <span
                  key={s}
                  className="rounded-md bg-[var(--c-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-accent)]"
                >
                  {scenarioLabel(s)}
                </span>
              ))}
              <span className="text-[10px] text-[var(--c-text-muted)]">
                {doc.source || 'manual'}{doc.version ? `@${doc.version}` : ''}{doc.packId ? ` · ${doc.packId}` : ''}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {builtin && (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedDoc(doc)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                >
                  <Eye size={13} />
                  <span>{t.projectsKnowledgeView}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExtractRules(doc)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                >
                  <Sparkles size={13} />
                  <span>{t.projectsKnowledgeExtractRules}</span>
                </button>
              </>
            )}
            {principle && (
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <input
                  type="checkbox"
                  checked={principle.enabled}
                  onChange={e => handleToggle(principle.id, e.target.checked)}
                  className="size-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
                  title={principle.enabled ? t.projectsPrinciplesEnabled : t.projectsPrinciplesDisabled}
                />
                <button
                  type="button"
                  onClick={() => handleReclassify(principle.id, 'rule')}
                  className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]"
                  title={t.projectsPrincipleMoveToRules ?? '移到规则'}
                >
                  <ArrowRight size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(principle, 'knowledge')}
                  className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]"
                  title={t.projectsPrinciplesEdit}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(principle.id)}
                  className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-status-error-text)]"
                  title={t.projectsPrinciplesDelete}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderRulePill(rule: QualityRuleView) {
    return (
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
  }

  function renderKnowledgeDocumentModal(doc: KnowledgeDocumentView) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setSelectedDoc(null)}>
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
        <div
          className="relative w-full max-w-2xl rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-6 shadow-xl"
          style={{ background: 'var(--c-bg-card)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[var(--c-text-primary)]">{doc.title || doc.id}</h3>
              <p className="mt-1 text-xs text-[var(--c-text-muted)]">{doc.source || 'manual'}{doc.packId ? ` · ${doc.packId}` : ''}</p>
            </div>
            <button type="button" onClick={() => setSelectedDoc(null)} className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
              <X size={16} />
            </button>
          </div>
          <pre className="max-h-[50vh] whitespace-pre-wrap rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 text-sm leading-6 text-[var(--c-text-primary)]" style={{ background: 'var(--c-bg-card)' }}>
            {doc.content}
          </pre>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setSelectedDoc(null)}
              className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
            >
              {t.projectsKnowledgeClose}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderExtractionModal(state: ExtractionState) {
    const canSave = state.status === 'ready' && state.rules.length > 0 && Boolean(state.patch);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setExtraction(null)}>
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
        <div
          className="relative w-full max-w-xl rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-6 shadow-xl"
          style={{ background: 'var(--c-bg-card)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[var(--c-text-primary)]">{t.projectsKnowledgeExtractedRules}</h3>
              <p className="mt-1 text-xs text-[var(--c-text-muted)]">{state.doc.title || state.doc.id}</p>
            </div>
            <button type="button" onClick={() => setExtraction(null)} className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
              <X size={16} />
            </button>
          </div>

          {state.status === 'loading' && <p className="text-sm text-[var(--c-text-secondary)]">{t.projectsKnowledgeExtracting}</p>}
          {state.status === 'error' && <p className="text-sm text-[var(--c-status-error-text)]">{state.error || t.projectsKnowledgeExtractFailed}</p>}
          {state.status === 'saved' && <p className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-3 text-sm text-[var(--c-text-primary)]">{t.projectsKnowledgeRulesSaved}</p>}
          {state.status === 'ready' && state.rules.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--c-border-subtle)] px-4 py-3 text-sm text-[var(--c-text-secondary)]">
              {t.projectsKnowledgeExtractEmpty}
            </p>
          )}
          {state.status === 'ready' && state.rules.length > 0 && (
            <div className="space-y-2">
              {state.rules.map(renderRulePill)}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setExtraction(null)}
              className="rounded-lg border border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
            >
              {t.projectsKnowledgeClose}
            </button>
            {state.status !== 'saved' && (
              <button
                type="button"
                onClick={handleSaveExtractedRules}
                disabled={!canSave}
                className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] disabled:pointer-events-none disabled:opacity-50"
              >
                {t.projectsKnowledgeSaveRules}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function scenarioLabel(s: PrincipleScenario) {
    switch (s) {
      case 'planning': return t.projectsPrinciplesScenarioPlanning;
      case 'execution': return t.projectsPrinciplesScenarioExecution;
      case 'review': return t.projectsPrinciplesScenarioReview;
      case 'delivery': return t.projectsPrinciplesScenarioDelivery;
    }
  }
}

function normalizeKnowledgeDocuments(value: unknown, builtinPacks: QualityPackView[]): KnowledgeDocumentView[] {
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeKnowledgeDocument(item))
      .filter((item): item is KnowledgeDocumentView => Boolean(item));
  }
  return builtinPacks.flatMap(pack => (pack.knowledgeDocuments || [])
    .map(doc => normalizeKnowledgeDocument({
      ...doc,
      packId: doc.packId || pack.id,
      source: doc.source || pack.source,
      version: doc.version || pack.version,
      readOnly: doc.readOnly !== false,
      rules: doc.rules || (pack.rules || []).map(rule => rule.id),
    }))
    .filter((item): item is KnowledgeDocumentView => Boolean(item)));
}

function normalizeKnowledgeDocument(item: any): KnowledgeDocumentView | null {
  if (!item?.id || !item?.content) return null;
  return {
    id: String(item.id),
    packId: item.packId ? String(item.packId) : undefined,
    title: item.title ? String(item.title) : String(item.id),
    source: item.source ? String(item.source) : undefined,
    version: Number.isFinite(item.version) ? item.version : undefined,
    content: String(item.content),
    rules: Array.isArray(item.rules) ? item.rules.map((rule: unknown) => String(rule)) : [],
    readOnly: item.readOnly !== false,
  };
}

function deriveKnowledgeTitle(content: string): string {
  const firstLine = String(content || '').split(/\n/)[0]?.trim() || '';
  return firstLine.length > 28 ? `${firstLine.slice(0, 28)}...` : firstLine || 'Knowledge';
}

async function postQuality(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${QUALITY_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.errors?.join(', ') || 'quality request failed');
  }
  return data;
}
