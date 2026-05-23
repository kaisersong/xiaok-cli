/**
 * CreateProjectModal — form to create a new kswarm project with agent selection.
 */

import { useState, useEffect } from 'react';
import { X, Check, FolderOpen } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmAgent } from '../../hooks/useKSwarmClient';
import { getPreferredPoAgentId, getPreferredWorkerSeedId } from '../../../../shared/kswarm-seed-contract.js';

interface CreateProjectModalProps {
  open: boolean;
  agents: KSwarmAgent[];
  onClose(): void;
  onCreate(input: { name: string; goal: string; requirements?: string; poAgent: string; members?: string[]; workFolder?: string; enableSummary?: boolean }): Promise<void>;
}

export function CreateProjectModal({ open, agents, onClose, onCreate }: CreateProjectModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [requirements, setRequirements] = useState('');
  const [poAgent, setPoAgent] = useState('');
  const [poTouched, setPoTouched] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [membersTouched, setMembersTouched] = useState(false);
  const [workFolder, setWorkFolder] = useState('');
  const [enableSummary, setEnableSummary] = useState(true);
  const [loading, setLoading] = useState(false);
  const [principlesCounts, setPrinciplesCounts] = useState<{ planning: number; execution: number }>({ planning: 0, execution: 0 });

  // Load principles count when modal opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const api = (window as any).xiaokDesktop;
        if (!api?.listPrinciples) return;
        const list = await api.listPrinciples();
        if (!Array.isArray(list)) return;
        const enabled = list.filter((p: any) => p.enabled);
        setPrinciplesCounts({
          planning: enabled.filter((p: any) => p.scenarios?.includes('planning')).length,
          execution: enabled.filter((p: any) => p.scenarios?.includes('execution')).length,
        });
      } catch {
        setPrinciplesCounts({ planning: 0, execution: 0 });
      }
    })();
  }, [open]);

  // Auto-select PO agent from the dedicated xiaok seed pair when available.
  useEffect(() => {
    if (open && !poTouched && agents.length > 0) {
      const preferredPo = getPreferredPoAgentId(agents);
      if (preferredPo && preferredPo !== poAgent) setPoAgent(preferredPo);
    }
  }, [open, agents, poAgent, poTouched]);

  const defaultWorkerSeedId = getPreferredWorkerSeedId(agents, poAgent);

  useEffect(() => {
    if (!open) return;
    if (membersTouched) return;
    setMembers(defaultWorkerSeedId ? [defaultWorkerSeedId] : []);
  }, [open, defaultWorkerSeedId, membersTouched]);

  useEffect(() => {
    if (!open) return;
    setPoTouched(false);
    setMembersTouched(false);
  }, [open]);

  if (!open) return null;

  const poAgents = agents.filter(a => a.roles?.includes('project_owner'));
  const workerAgents = agents.filter(a => a.id !== poAgent);

  const toggleMember = (id: string) => {
    setMembers(prev => {
      const base = !membersTouched
        && defaultWorkerSeedId
        && prev.length === 1
        && prev[0] === defaultWorkerSeedId
        && id !== defaultWorkerSeedId
        ? []
        : prev;
      return base.includes(id) ? base.filter(m => m !== id) : [...base, id];
    });
    setMembersTouched(true);
  };

  const handlePickWorkFolder = async () => {
    try {
      const result = await (window as any).xiaokDesktop?.selectDirectory?.();
      if (result?.filePath) setWorkFolder(result.filePath);
    } catch { /* user cancelled or desktop API unavailable */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !goal.trim() || !poAgent) return;
    setLoading(true);
    try {
      await onCreate({
        name: name.trim(),
        goal: goal.trim(),
        requirements: requirements.trim() || undefined,
        poAgent,
        members: members.length > 0 ? members : undefined,
        workFolder: workFolder.trim() || undefined,
        enableSummary,
      });
      setName('');
      setGoal('');
      setRequirements('');
      setPoAgent('');
      setPoTouched(false);
      setMembers([]);
      setMembersTouched(false);
      setWorkFolder('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/12 backdrop-blur-[2px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-6 shadow-xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--c-text-heading)]">{t.projectsCreateTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] transition-colors duration-150"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsCreateName}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：竞品分析报告"
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsCreateGoal}</label>
            <input
              type="text"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="描述你希望完成什么..."
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">
              {t.projectsCreateRequirements}
            </label>
            <textarea
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
              placeholder="格式要求、参考资料、限制条件、期望的产出物形式..."
              rows={4}
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)] resize-none"
            />
          </div>

          {/* PO Agent selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsCreatePoAgent}</label>
            {agents.length === 0 ? (
              <p className="text-[12px] text-[var(--c-text-muted)] py-2">暂无可用智能体，请先在 kswarm 中创建</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(poAgents.length > 0 ? poAgents : agents).map(agent => {
                  const selected = poAgent === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        setPoAgent(agent.id);
                        setPoTouched(true);
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                        selected
                          ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)] ring-1 ring-[var(--c-border-mid)]'
                          : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
                      }`}
                    >
                      {selected && <Check size={12} className="text-[var(--c-status-success-text)]" />}
                      <span>{agent.name}</span>
                      {agent.status === 'offline' && (
                        <span className="text-[10px] text-[var(--c-text-muted)]">(离线)</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Worker members selection */}
          {workerAgents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">
                {t.projectsCreateWorkerAgent} <span className="text-[var(--c-text-muted)]">(可多选，可选)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {workerAgents.map(agent => {
                  const selected = members.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleMember(agent.id)}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                        selected
                          ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)] ring-1 ring-[var(--c-border-mid)]'
                          : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
                      }`}
                    >
                      {selected && <Check size={12} className="text-[var(--c-status-success-text)]" />}
                      <span>{agent.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Work folder */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">
              {t.projectsCreateWorkDir} <span className="text-[var(--c-text-muted)]">(可选，留空自动创建)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={workFolder}
                onChange={e => setWorkFolder(e.target.value)}
                placeholder="~/projects/my-project"
                className="flex-1 rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
              />
              <button
                type="button"
                onClick={handlePickWorkFolder}
                className="rounded-lg p-2 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] transition-colors duration-150"
                title="选择目录"
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {/* Summary toggle */}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={enableSummary}
              onChange={e => setEnableSummary(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
              id="enableSummary"
            />
            <label htmlFor="enableSummary" className="text-xs text-[var(--c-text-secondary)]">
              {t.projectsSummaryEnable}
            </label>
          </div>

          {(principlesCounts.planning > 0 || principlesCounts.execution > 0) && (
            <p className="mt-3 text-[11px] text-[var(--c-text-muted)]">
              {t.projectsPrinciplesInjectHint(principlesCounts.planning, principlesCounts.execution)}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-1.5 text-sm text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              {t.projectsCreateCancel}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !goal.trim() || !poAgent || loading}
              className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95] disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? t.projectsCreateCreating : t.projectsCreateSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
