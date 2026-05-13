/**
 * EditAgentModal — edit an existing kswarm agent's configuration.
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

  const PROVIDERS = [
    { value: '', label: t.commonNoConfig },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'ollama', label: 'Ollama' },
  ];

  const [name, setName] = useState(agent.name);
  const [provider, setProvider] = useState((agent as any).provider || '');
  const [model, setModel] = useState((agent as any).model || '');
  const [baseUrl, setBaseUrl] = useState((agent as any).baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [instructions, setInstructions] = useState((agent as any).instructions || '');
  const [loading, setLoading] = useState(false);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/12 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--c-text-heading)]">{t.projectsEditAgentTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] transition-colors duration-150"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsEditAgentName}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">ID</label>
            <input
              type="text"
              value={agent.id}
              disabled
              className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-deep)] px-3 py-2 text-sm text-[var(--c-text-muted)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">LLM 提供商</label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)]"
            >
              {PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsEditAgentModel}</label>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                  className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
                />
              </div>
              {(provider === 'openai' || provider === 'ollama') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.commonBaseUrl}</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
                  />
                </div>
              )}
              {provider !== 'ollama' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.commonApiKey}</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={t.projectsEditAgentModelHint}
                    className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)]"
                  />
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsEditAgentInstructions}</label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="系统提示词..."
              rows={3}
              className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none transition-all focus:border-[var(--c-input-border-color-focus)] focus:shadow-[var(--c-input-shadow-focus)] resize-none"
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-1.5 text-sm text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              {t.projectsEditAgentClose}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || loading}
              className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95] disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? t.projectsEditAgentSaving : t.projectsEditAgentSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
