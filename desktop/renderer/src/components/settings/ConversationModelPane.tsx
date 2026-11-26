import { SecretInput } from '../security/SecretInput';
import { modelConfigErrorMessage } from '../../lib/model-config-error';
import { useState, useEffect } from 'react';
import {
  Cpu,
  Loader2,
  Check,
  X,
  Trash2,
  Plus,
  Edit3,
  Eye,
  EyeOff,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { api } from '../../api';
import type { DesktopModelConfigSnapshot, DesktopSaveModelConfigInput, TestProviderConnectionResult } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, inputCls } from './settings-ui';
import { AddProviderCard } from './AddProviderCard';

// ---- Model Settings ----

const KIMI_K3_CONTEXT_262K = 262_144;
const KIMI_K3_CONTEXT_1M = 1_048_576;
const KIMI_K3_REASONING_EFFORTS = ['low', 'high', 'max'] as const;

type KimiK3ContextLimit = typeof KIMI_K3_CONTEXT_262K | typeof KIMI_K3_CONTEXT_1M;
type KimiK3ReasoningEffort = typeof KIMI_K3_REASONING_EFFORTS[number];
type DesktopModelEntry = DesktopModelConfigSnapshot['models'][number];

function supportsKimiK3RuntimeOptions(model: DesktopModelEntry | undefined): boolean {
  const constraints = model?.runtimeConstraints;
  return Boolean(
    model?.runtimeOptions
    && constraints?.maxContextLimit !== undefined
    && constraints.maxContextLimit >= KIMI_K3_CONTEXT_1M
    && KIMI_K3_REASONING_EFFORTS.every(effort => constraints.reasoningEfforts?.includes(effort)),
  );
}

export function ConversationModelPane() {
  const { t } = useLocale();
  const [config, setConfig] = useState<DesktopModelConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestProviderConnectionResult>>({});
  const [showAddModel, setShowAddModel] = useState<string>('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [runtimeContextLimit, setRuntimeContextLimit] = useState<KimiK3ContextLimit>(KIMI_K3_CONTEXT_262K);
  const [runtimeReasoningEffort, setRuntimeReasoningEffort] = useState<KimiK3ReasoningEffort>('high');
  const [savingRuntimeOptions, setSavingRuntimeOptions] = useState(false);

  const currentModel = config?.models.find(model => model.id === config.defaultModelId)
    ?? config?.models.find(model => model.isDefault);
  const currentProvider = currentModel
    ? config?.providers.find(provider => provider.id === currentModel.provider)
    : undefined;
  const showKimiK3RuntimeOptions = supportsKimiK3RuntimeOptions(currentModel);
  const modelMutationPending = saving || savingRuntimeOptions;

  useEffect(() => {
    api.getModelConfig()
      .then(c => {
        setConfig(c);
      })
      .catch(e => setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setRuntimeContextLimit(
      currentModel?.runtimeOptions?.contextLimit === KIMI_K3_CONTEXT_1M
        ? KIMI_K3_CONTEXT_1M
        : KIMI_K3_CONTEXT_262K,
    );
    const nextEffort = currentModel?.runtimeOptions?.reasoningEffort;
    setRuntimeReasoningEffort(
      KIMI_K3_REASONING_EFFORTS.find(effort => effort === nextEffort) ?? 'high',
    );
  }, [currentModel?.id, currentModel?.runtimeOptions?.contextLimit, currentModel?.runtimeOptions?.reasoningEffort]);

  const handleSave = async () => {
    if (!selectedProvider || !apiKey.trim() || modelMutationPending) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const input: DesktopSaveModelConfigInput = {
        providerId: selectedProvider,
        apiKey: apiKey.trim(),
      };
      const updated = await api.saveModelConfig(input);
      setConfig(updated);
      setApiKey('');
      setSuccess(t.desktopSettings.apiKeyUpdated(updated.providers.find(p => p.id === selectedProvider)?.label ?? selectedProvider));
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerId: string) => {
    if (!providerId) return;
    const providerDefaultModelId = config?.providerProfiles.find(profile => profile.id === providerId)?.defaultModelId;
    const testedModel = config?.models.find(model => (
      model.provider === providerId && model.id === providerDefaultModelId
    )) ?? config?.models.find(model => model.provider === providerId);
    setTesting(prev => ({ ...prev, [providerId]: true }));
    setError('');
    try {
      const result = await api.testProviderConnection({ providerId });
      setTestResults(prev => ({ ...prev, [providerId]: result }));
      if (result.success) {
        setSuccess(t.desktopSettings.connectionSuccessLatency(result.latencyMs ?? 0));
      } else {
        const diagnostic = result.error || t.desktopSettings.connectionFailed;
        const guidance = supportsKimiK3RuntimeOptions(testedModel)
          ? ` ${t.desktopSettings.kimiK3ConnectionErrorAdvice}`
          : '';
        setError(`${diagnostic}${guidance}`);
      }
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const handleAddModel = async (modelId: string) => {
    if (!config || modelMutationPending) return;
    // Find the model across all provider profiles
    let foundModel: { modelId: string; model: string; label: string } | undefined;
    let foundProviderId = '';
    for (const profile of config.providerProfiles) {
      const m = profile.availableModels?.find(am => am.modelId === modelId);
      if (m) { foundModel = m; foundProviderId = profile.id; break; }
    }
    if (!foundModel || !foundProviderId) return;
    setSaving(true);
    setError('');
    try {
      await api.saveModelConfig({
        providerId: foundProviderId,
        modelName: foundModel.model,
        label: foundModel.label,
      });
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.modelAdded(foundModel.label));
      setShowAddModel('');
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomModel = async (providerId: string, modelName: string) => {
    if (!config || !modelName.trim() || modelMutationPending) return;
    setSaving(true);
    setError('');
    try {
      await api.saveModelConfig({
        providerId,
        modelName: modelName.trim(),
        label: modelName.trim(),
      });
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.customModelAdded(modelName.trim()));
      setShowAddModel('');
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultModel = async (modelId: string) => {
    if (!config || config.defaultModelId === modelId || modelMutationPending) return;
    const model = config.models.find(m => m.id === modelId);
    if (!model) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.saveModelConfig({
        providerId: model.provider,
        modelId,
      });
      setConfig(updated);
      const updatedCurrentModel = updated.models.find(candidate => candidate.id === updated.defaultModelId)
        ?? updated.models.find(candidate => candidate.isDefault);
      const newSessionHint = supportsKimiK3RuntimeOptions(updatedCurrentModel)
        ? ` ${t.desktopSettings.kimiK3NewSessionHint}`
        : '';
      setSuccess(`${t.desktopSettings.modelSwitched(updatedCurrentModel?.label ?? model.label)}${newSessionHint}`);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRuntimeOptions = async () => {
    if (!currentModel || !showKimiK3RuntimeOptions || modelMutationPending) return;
    setSavingRuntimeOptions(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.updateModelRuntimeOptions({
        modelId: currentModel.id,
        runtimeOptions: {
          contextLimit: runtimeContextLimit,
          reasoningEffort: runtimeReasoningEffort,
        },
      });
      setConfig(updated);
      setSuccess(`${t.desktopSettings.kimiK3RuntimeOptionsSaved} ${t.desktopSettings.kimiK3NewSessionHint}`);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSavingRuntimeOptions(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (modelMutationPending) return;
    if (!confirm(t.desktopSettings.confirmDeleteModel)) return;
    setSaving(true);
    try {
      await api.deleteModel(modelId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.modelDeleted);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (modelMutationPending) return;
    if (!confirm(t.desktopSettings.confirmDeleteProvider)) return;
    setSaving(true);
    try {
      await api.deleteProvider(providerId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      if (selectedProvider === providerId) {
        setSelectedProvider(updated.providers[0]?.id ?? '');
      }
      setSuccess(t.desktopSettings.providerDeleted);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.modelProviders}</SectionHeader>
        {currentModel && (
          <Card className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.currentModel}</div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--c-text-primary)]">{currentModel.label}</span>
                  <span className="rounded-md bg-[var(--c-bg-deep)] px-2 py-0.5 text-xs text-[var(--c-text-secondary)]">
                    {currentProvider?.label ?? currentModel.provider}
                  </span>
                </div>
                {currentModel.capabilities && currentModel.capabilities.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {currentModel.capabilities.map(capability => (
                      <span key={capability} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--c-text-tertiary)] bg-[var(--c-bg-deep)]">
                        {capability}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {showKimiK3RuntimeOptions && (
              <div className="mt-4 border-t border-[var(--c-border-subtle)] pt-3">
                <div className="text-xs font-medium text-[var(--c-text-primary)]">{t.desktopSettings.kimiK3RuntimeTitle}</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="desktop-kimi-k3-context-limit" className="mb-1.5 block text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.kimiK3ContextLabel}
                    </label>
                    <select
                      id="desktop-kimi-k3-context-limit"
                      value={runtimeContextLimit}
                      onChange={event => setRuntimeContextLimit(Number(event.target.value) as KimiK3ContextLimit)}
                      disabled={modelMutationPending}
                      className={inputCls}
                    >
                      <option value={KIMI_K3_CONTEXT_262K}>{t.desktopSettings.kimiK3Context262k}</option>
                      <option value={KIMI_K3_CONTEXT_1M}>{t.desktopSettings.kimiK3Context1m}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="desktop-kimi-k3-reasoning-effort" className="mb-1.5 block text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.kimiK3EffortLabel}
                    </label>
                    <select
                      id="desktop-kimi-k3-reasoning-effort"
                      value={runtimeReasoningEffort}
                      onChange={event => setRuntimeReasoningEffort(event.target.value as KimiK3ReasoningEffort)}
                      disabled={modelMutationPending}
                      className={inputCls}
                    >
                      <option value="low">{t.desktopSettings.kimiK3EffortLow}</option>
                      <option value="high">{t.desktopSettings.kimiK3EffortHigh}</option>
                      <option value="max">{t.desktopSettings.kimiK3EffortMax}</option>
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.kimiK3AllegrettoHint}</p>
                <button
                  type="button"
                  onClick={() => void handleSaveRuntimeOptions()}
                  disabled={modelMutationPending}
                  className="mt-3 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {savingRuntimeOptions ? `${t.desktopSettings.kimiK3SaveRuntimeOptions}…` : t.desktopSettings.kimiK3SaveRuntimeOptions}
                </button>
              </div>
            )}
          </Card>
        )}
        <div className="flex flex-col gap-3">
          {config?.providers.map(provider => {
            const testResult = testResults[provider.id];
            return (
              <Card key={provider.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{provider.label}</span>
                      {provider.apiKeyConfigured ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">
                          <Check size={12} /> {t.desktopSettings.configured}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">
                          <AlertCircle size={12} /> {t.desktopSettings.notConfigured}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.protocol}: {provider.protocol}
                      {provider.baseUrl && ` · ${provider.baseUrl}`}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <button type="button"
                        onClick={() => handleTest(provider.id)}
                        disabled={testing[provider.id]}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                      >
                        {testing[provider.id] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        {t.desktopSettings.testConnection}
                      </button>
                      <button type="button"
                        onClick={() => { setSelectedProvider(prev => prev === provider.id ? '' : provider.id); setApiKey(''); }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                      >
                        <Edit3 size={12} /> {provider.apiKeyConfigured ? t.desktopSettings.updateKey : t.desktopSettings.setKey}
                      </button>
                      {testResult && (
                        <span className={`text-xs truncate max-w-[200px] ${testResult.success ? 'text-green-600' : 'text-red-500'}`}>
                          {testResult.success
                            ? t.desktopSettings.latencyMs(testResult.latencyMs ?? 0)
                            : testResult.error}
                        </span>
                      )}
                      {(
                        <button type="button"
                          onClick={() => handleDeleteProvider(provider.id)}
                          disabled={modelMutationPending}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={12} /> {t.desktopSettings.deleteLabel}
                        </button>
                      )}
                    </div>
                    {/* Inline API Key input */}
                    {selectedProvider === provider.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="relative flex-1">
                          <SecretInput aria-label="sk-..."
                            revealed={showKey}
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            className={`${inputCls} pr-10 !py-1.5 text-xs`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]"
                          >
                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        <button type="button"
                          onClick={handleSave}
                          disabled={modelMutationPending || !apiKey.trim()}
                          className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {saving ? '...' : t.desktopSettings.saveLabel}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Model list */}
                {config?.models && (
                  <div className="mt-3 pt-3 border-t border-[var(--c-border-subtle)]">
                    <div className="text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.configuredModels}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {config.models
                        .filter(m => m.provider === provider.id)
                        .map(m => (
                          <span
                            key={m.id}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                              config.defaultModelId === m.id
                                ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                                : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                            }`}
                          >
                            {m.label}
                            {config.defaultModelId === m.id && ` ${t.desktopSettings.defaultBadge}`}
                            {config.defaultModelId !== m.id && (
                              <button type="button"
                                onClick={() => void handleSetDefaultModel(m.id)}
                                disabled={modelMutationPending}
                                className="ml-1 rounded px-1 text-[10px] text-[var(--c-accent)] hover:bg-[var(--c-accent)]/10 disabled:opacity-50"
                              >
                                {t.desktopSettings.setAsDefault}
                              </button>
                            )}
                            <button type="button"
                              onClick={() => handleDeleteModel(m.id)}
                              disabled={modelMutationPending}
                              className="ml-1 hover:text-red-500 disabled:opacity-50"
                              title={t.desktopSettings.deleteModel}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                    </div>
                    {/* Add model from profile's available models */}
                    {(() => {
                      const profile = config.providerProfiles.find(p => p.id === provider.id);
                      const profileModels = profile?.availableModels ?? [];
                      const configuredModels = config.models.filter(m => m.provider === provider.id);
                      const addable = profileModels.filter(m => !configuredModels.some(cm => cm.model === m.model));
                      return (
                        <div className="mt-2">
                          <button type="button"
                            onClick={() => { setShowAddModel(prev => prev === provider.id ? '' : provider.id); setCustomModelInput(''); }}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                          >
                            <Plus size={12} /> {t.desktopSettings.addModel}
                          </button>
                          {showAddModel === provider.id && (
                            <div className="mt-2 space-y-2">
                              {addable.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {addable.map(m => (
                                    <button type="button"
                                      key={m.modelId}
                                      onClick={() => handleAddModel(m.modelId)}
                                      disabled={modelMutationPending}
                                      className="rounded-md px-2 py-1 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] hover:bg-[var(--c-accent)]/10 hover:text-[var(--c-accent)] transition-colors disabled:opacity-50"
                                    >
                                      {m.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={customModelInput}
                                  onChange={e => setCustomModelInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && customModelInput.trim()) { void handleAddCustomModel(provider.id, customModelInput); setCustomModelInput(''); } }}
                                  placeholder={t.desktopSettings.customModelPlaceholder}
                                  aria-label={t.desktopSettings.customModelPlaceholder}
                                  className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-1 text-xs text-[var(--c-text-primary)] placeholder:text-[var(--c-text-tertiary)] outline-none focus:border-[var(--c-accent)]"
                                />
                                <button type="button"
                                  onClick={() => { void handleAddCustomModel(provider.id, customModelInput); setCustomModelInput(''); }}
                                  disabled={modelMutationPending || !customModelInput.trim()}
                                  className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
                                >
                                  {t.desktopSettings.addLabel}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      {error && !loading && (
        <Section>
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </Section>
      )}

      {success && (
        <Section>
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-600">
            {success}
          </div>
        </Section>
      )}

      <Section>
        <SectionHeader icon={Plus}>{t.desktopSettings.addModelProvider}</SectionHeader>
        <AddProviderCard
          config={config}
          mutationPending={modelMutationPending}
          onMutationPendingChange={setSaving}
          onAdded={(updated) => {
            setConfig(updated);
            setSuccess(t.desktopSettings.providerAdded);
          }}
          onError={setError}
        />
      </Section>
    </>
  );
}
