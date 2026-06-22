/**
 * EditAgentModal — edit an existing kswarm agent's configuration.
 * Uses dynamic provider/model lists from Desktop config (same as CreateAgentModal).
 */

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import { api } from '../../api';
import type { KSwarmAgent } from '../../hooks/useKSwarmClient';

interface DesktopProvider {
  id: string;
  label: string;
  apiKeyConfigured: boolean;
}

interface DesktopModel {
  modelId: string;
  model: string;
  label: string;
}

interface EditAgentModalProps {
  agent: KSwarmAgent;
  onClose(): void;
}

export function EditAgentModal({ agent, onClose }: EditAgentModalProps) {
  const { updateAgent } = useKSwarm();
  const { t } = useLocale();

  const [name, setName] = useState(agent.name);
  const [provider, setProvider] = useState(agent.provider || '');
  const [model, setModel] = useState(agent.model || '');
  const [baseUrl, setBaseUrl] = useState(agent.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [instructions, setInstructions] = useState(agent.instructions || '');
  const [loading, setLoading] = useState(false);

  const [desktopProviders, setDesktopProviders] = useState<DesktopProvider[]>([]);
  const [desktopModels, setDesktopModels] = useState<DesktopModel[]>([]);

  // Load desktop providers on mount
  useEffect(() => {
    api.getModelConfig()
      .then(c => setDesktopProviders(c.providers ?? []))
      .catch(() => {});
  }, []);

  // Load available models when provider changes
  useEffect(() => {
    if (!provider) { setDesktopModels([]); return; }
    api.listAvailableModelsForProvider(provider)
      .then(m => setDesktopModels(m ?? []))
      .catch(() => setDesktopModels([]));
  }, [provider]);

  const providerOptions = [
    { value: '', label: t.projectsAgentFollowPlatform },
    ...desktopProviders.map(p => ({
      value: p.id,
      label: `${p.label}${p.apiKeyConfigured ? '' : ` (${t.projectsEditAgentApiKeyNotConfigured})`}`,
    })),
  ];

  const handleSave = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await updateAgent(agent.id, {
        name: name.trim(),
        provider: provider || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
        instructions: instructions || undefined,
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
            <label htmlFor="edit-agent-provider" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsEditAgentProviderLabel}</label>
            <select
              id="edit-agent-provider"
              data-testid="provider-select"
              value={provider}
              onChange={e => { setProvider(e.target.value); setModel(''); }}
              className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]"
            >
              {providerOptions.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsEditAgentModel}</label>
                {desktopModels.length > 0 ? (
                  <select
                    data-testid="model-select"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]"
                  >
                    <option value="">{t.projectsEditAgentSelectModel}</option>
                    {desktopModels.map(m => <option key={m.modelId} value={m.model}>{m.label}</option>)}
                  </select>
                ) : (
                  <input aria-label="e.g. gpt-4o"
                    data-testid="model-input"
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o"
                    className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] transition-colors duration-150 focus:border-[var(--c-border)]"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.commonBaseUrl}</label>
                <input aria-label="https://api.example.com/v1"
                  data-testid="baseurl-input"
                  type="text"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] transition-colors duration-150 focus:border-[var(--c-border)]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.commonApiKey}</label>
                <input aria-label={t.projectsEditAgentModelHint}
                  data-testid="apikey-input"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={t.projectsEditAgentModelHint}
                  className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)] transition-colors duration-150 focus:border-[var(--c-border)]"
                />
              </div>
            </>
          )}

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
