/**
 * EditAgentModal — edit an existing kswarm agent's configuration.
 * Native CLI runtimes own their provider/model/login configuration.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmAgent } from '../../hooks/useKSwarmClient';

interface EditAgentModalProps {
  agent: KSwarmAgent;
  onClose(): void;
}

export function EditAgentModal({ agent, onClose }: EditAgentModalProps) {
  const { updateAgent } = useKSwarm();
  const { t } = useLocale();

  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions || '');
  const [fallbackToDesktopModel, setFallbackToDesktopModel] = useState(agent.fallbackToDesktopModel === true);
  const [loading, setLoading] = useState(false);

  const runtimeName = agent.runtimeType === 'xiaok' ? 'xiaok' : displayRuntimeName(agent.runtimeType);

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await updateAgent(agent.id, {
        name: name.trim(),
        instructions: instructions || undefined,
        fallbackToDesktopModel,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="overlay-fade-in fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--c-overlay)' }}
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="modal-enter flex w-full max-w-md flex-col rounded-[14px] p-6"
        style={{ background: 'var(--c-bg-card)', border: '0.5px solid var(--c-border-subtle)', maxHeight: '80vh', margin: '0 20px', overflowY: 'auto' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--c-text-heading)]">{t.projectsEditAgentTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-[var(--c-text-muted)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)] hover:text-[var(--c-text-secondary)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-agent-name" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsEditAgentName}</label>
            <input
              id="edit-agent-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] transition-colors duration-150 focus:border-[var(--c-border)]"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-agent-id" className="text-[12px] font-medium text-[var(--c-text-secondary)]">ID</label>
            <input
              id="edit-agent-id"
              type="text"
              value={agent.id}
              disabled
              className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-sub)] px-3 py-2 text-sm text-[var(--c-text-muted)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-agent-runtime" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentRuntimeTitle}</label>
            <input
              id="edit-agent-runtime"
              type="text"
              value={runtimeName}
              disabled
              className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-sub)] px-3 py-2 text-sm text-[var(--c-text-muted)]"
            />
            {agent.runtimeType !== 'xiaok' && (
              <p className="text-[10px] text-[var(--c-text-muted)]">{t.projectsAgentUsesPlatformConfig(runtimeName)}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsEditAgentInstructions}</label>
            <textarea aria-label={t.projectsEditAgentSystemPromptPlaceholder}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder={t.projectsEditAgentSystemPromptPlaceholder}
              rows={3}
              className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] transition-colors duration-150 focus:border-[var(--c-border)] resize-none"
            />
          </div>

          {agent.runtimeType === 'xiaok' ? (
            <p className="rounded-lg bg-[var(--c-bg-sub)] px-3 py-2 text-xs text-[var(--c-text-tertiary)]">
              {t.projectsEditAgentAlreadyUsesDesktopModel}
            </p>
          ) : (
            <label className="flex items-start gap-2 rounded-lg border border-[var(--c-border-subtle)] p-3">
              <input
                type="checkbox"
                checked={fallbackToDesktopModel}
                onChange={event => setFallbackToDesktopModel(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs font-medium text-[var(--c-text-secondary)]">{t.projectsEditAgentFallbackToDesktopModel}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--c-text-tertiary)]">{t.projectsEditAgentFallbackToDesktopModelHint}</span>
              </span>
            </label>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[var(--c-bg-page)] px-4 py-2 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)]"
            >
              {t.projectsEditAgentClose}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || loading}
              className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-2 text-sm font-medium text-[var(--c-btn-text)] transition-colors duration-150 hover:brightness-[1.08] disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? t.projectsEditAgentSaving : t.projectsEditAgentSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function displayRuntimeName(runtimeType?: string): string {
  const normalized = String(runtimeType || '').trim();
  if (!normalized) return 'xiaok';
  return normalized === 'kimi' ? 'Kimi' : normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
