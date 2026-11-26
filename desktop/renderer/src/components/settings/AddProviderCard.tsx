import { modelConfigErrorMessage } from '../../lib/model-config-error';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../../api';
import type { DesktopModelConfigSnapshot } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';
import { Card, inputCls, btnPrimary } from './settings-ui';

// ---- Skills ----

// ---- Add Provider Card ----

export function AddProviderCard({
  config,
  mutationPending,
  onMutationPendingChange,
  onAdded,
  onError,
}: {
  config: DesktopModelConfigSnapshot | null;
  mutationPending: boolean;
  onMutationPendingChange: (pending: boolean) => void;
  onAdded: (updated: DesktopModelConfigSnapshot) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useLocale();
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customName, setCustomName] = useState('');

  const profiles = config?.providerProfiles ?? [];
  const configuredIds = new Set(config?.providers.map(p => p.id) ?? []);

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const isCustom = selectedProfileId === '__custom__';

  const handleProfileChange = (id: string) => {
    setSelectedProfileId(id);
    if (id === '__custom__') {
      setBaseUrl('');
    } else {
      const profile = profiles.find(p => p.id === id);
      setBaseUrl(profile?.baseUrl ?? '');
    }
    setProviderApiKey('');
  };

  const handleAdd = async () => {
    if (!selectedProfileId || mutationPending) return;
    if (isCustom && !customName.trim()) {
      onError(t.desktopSettings.customNameRequired);
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      onError(t.desktopSettings.customBaseUrlRequired);
      return;
    }
    setSaving(true);
    onMutationPendingChange(true);
    try {
      const providerId = isCustom ? customName.trim().toLowerCase().replace(/\s+/g, '-') : selectedProfileId;
      const updated = await api.saveModelConfig({
        providerId,
        apiKey: providerApiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      onAdded(updated);
      setSelectedProfileId('');
      setBaseUrl('');
      setProviderApiKey('');
      setCustomName('');
    } catch (e) {
      onError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
      onMutationPendingChange(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="desktop-model-provider-profile" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.selectProvider}</label>
          <select
            id="desktop-model-provider-profile"
            value={selectedProfileId}
            onChange={e => handleProfileChange(e.target.value)}
            className={inputCls}
          >
            <option value="">{t.desktopSettings.selectProviderPlaceholder}</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}{configuredIds.has(p.id) ? ` ${t.desktopSettings.alreadyConfigured}` : ''}
              </option>
            ))}
            <option value="__custom__">{t.desktopSettings.customOpenaiCompatible}</option>
          </select>
        </div>

        {isCustom && (
          <div>
            <label htmlFor="desktop-custom-provider-name" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.providerName}</label>
            <input
              id="desktop-custom-provider-name"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="my-provider"
              className={inputCls}
            />
          </div>
        )}

        {selectedProfileId && (
          <>
            <div>
              <label htmlFor="desktop-provider-base-url" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.commonBaseUrl}</label>
              <input
                id="desktop-provider-base-url"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="desktop-provider-api-key" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.commonApiKey}</label>
              <div className="relative">
                <input
                  id="desktop-provider-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={providerApiKey}
                  onChange={e => setProviderApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Available models preview */}
            {selectedProfile?.availableModels && selectedProfile.availableModels.length > 0 && (
              <div>
                <div className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.availableModels}</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.availableModels.map(m => (
                    <span
                      key={m.modelId}
                      className="inline-flex items-center rounded-md bg-[var(--c-bg-deep)] px-2 py-1 text-xs text-[var(--c-text-secondary)]"
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
                <span className="mt-1 block text-[11px] text-[var(--c-text-muted)]">{t.desktopSettings.defaultModelAfterAdd(selectedProfile.defaultModelLabel)}</span>
              </div>
            )}

            {!isCustom && selectedProfile && (
              <div className="text-[11px] text-[var(--c-text-muted)]">
                {t.desktopSettings.protocol}: {selectedProfile.protocol}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button"
                onClick={handleAdd}
                disabled={saving || mutationPending}
                className={btnPrimary}
              >
                {saving ? t.desktopSettings.addingProvider : t.desktopSettings.addProvider}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
