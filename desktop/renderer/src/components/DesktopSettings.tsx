import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  Settings,
  Cpu,
  Palette,
  Database,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import type { DesktopModelConfigSnapshot, DesktopSaveModelConfigInput } from '../../../electron/preload-api';

type SettingsTab = 'general' | 'appearance' | 'providers' | 'memory' | 'advanced';

interface NavItem {
  key: SettingsTab;
  icon: typeof Settings;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'general', icon: Settings, label: 'General' },
  { key: 'appearance', icon: Palette, label: 'Appearance' },
  { key: 'providers', icon: Cpu, label: 'Providers' },
  { key: 'memory', icon: Database, label: 'Memory' },
  { key: 'advanced', icon: SlidersHorizontal, label: 'Advanced' },
];

interface Props {
  onClose: () => void;
}

export function DesktopSettings({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Nav */}
      <div className="flex w-[240px] shrink-0 flex-col overflow-y-auto py-4" style={{ borderRight: '0.5px solid var(--c-border)' }}>
        <div className="mb-4 px-4">
          <button
            onClick={onClose}
            className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep,rgba(0,0,0,0.05))] hover:text-[var(--c-text-primary)]"
          >
            <ChevronLeft size={16} />
            Settings
          </button>
        </div>
        <div className="px-4">
          <div className="flex flex-col gap-[3px]">
            {NAV_ITEMS.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'flex h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-sm transition-all active:scale-[0.96]',
                  activeTab === key
                    ? 'bg-[var(--c-bg-deep,rgba(0,0,0,0.06))] text-[var(--c-text-primary)] rounded-[10px]'
                    : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep,rgba(0,0,0,0.04))] hover:text-[var(--c-text-primary)]',
                ].join(' ')}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {activeTab === 'general' && <GeneralPane />}
        {activeTab === 'appearance' && <AppearancePane />}
        {activeTab === 'providers' && <ProvidersPane />}
        {activeTab === 'memory' && <MemoryPane />}
        {activeTab === 'advanced' && <AdvancedPane />}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-sm font-medium">{children}</h3>;
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="mb-6">{children}</div>;
}

const inputCls = 'w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]';
const selectCls = inputCls + ' cursor-pointer';

// ---- General ----

function GeneralPane() {
  return (
    <>
      <Section>
        <SectionHeader>User</SectionHeader>
        <div className="flex items-center gap-3 rounded-lg border border-[var(--c-border)] p-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-[var(--c-accent)] text-sm text-white">L</div>
          <div>
            <div className="text-sm font-medium">Local User</div>
            <div className="text-xs text-[var(--c-text-secondary)]">local@xiaok</div>
          </div>
        </div>
      </Section>
      <Section>
        <SectionHeader>About</SectionHeader>
        <div className="text-sm text-[var(--c-text-secondary)]">
          xiaok desktop — local mode<br />
          No cloud sync, no login required.
        </div>
      </Section>
    </>
  );
}

// ---- Appearance ----

function AppearancePane() {
  const [fontSize, setFontSize] = useState('14');

  return (
    <>
      <Section>
        <SectionHeader>Font Size</SectionHeader>
        <select
          value={fontSize}
          onChange={e => setFontSize(e.target.value)}
          className={selectCls}
        >
          <option value="12">Small (12px)</option>
          <option value="14">Medium (14px)</option>
          <option value="16">Large (16px)</option>
        </select>
      </Section>
      <Section>
        <SectionHeader>Density</SectionHeader>
        <div className="flex gap-2">
          {(['Comfortable', 'Compact'] as const).map(d => (
            <button
              key={d}
              className="rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm hover:border-[var(--c-accent)]"
            >
              {d}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---- Providers ----

function ProvidersPane() {
  const [config, setConfig] = useState<DesktopModelConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getModelConfig()
      .then(setConfig)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (providerId: string) => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const input: DesktopSaveModelConfigInput = { providerId, apiKey: apiKey.trim() };
      const updated = await api.saveModelConfig(input);
      setConfig(updated);
      setApiKey('');
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  if (error && !config) {
    return <div className="text-sm text-red-500">Failed to load config: {error}</div>;
  }

  return (
    <>
      <Section>
        <SectionHeader>Model Providers</SectionHeader>
        {config?.providers.map(provider => (
          <div key={provider.id} className="mb-3 rounded-lg border border-[var(--c-border)] p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{provider.label}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">
                  {provider.protocol} {provider.baseUrl && `· ${provider.baseUrl}`}
                </div>
              </div>
              <span className={['rounded-full px-2 py-0.5 text-xs', provider.apiKeyConfigured ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'].join(' ')}>
                {provider.apiKeyConfigured ? 'Configured' : 'No API Key'}
              </span>
            </div>
          </div>
        ))}
      </Section>

      <Section>
        <SectionHeader>Default Model</SectionHeader>
        {config && (
          <div className="text-sm">
            {config.models.find(m => m.id === config.defaultModelId)?.label ?? config.defaultModelId}
            <span className="ml-2 text-xs text-[var(--c-text-secondary)]">
              via {config.defaultProvider}
            </span>
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader>Set API Key</SectionHeader>
        <div className="flex gap-2">
          <select
            id="provider-select"
            className={`${selectCls} w-40 shrink-0`}
          >
            {config?.providers.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => {
              const select = document.getElementById('provider-select') as HTMLSelectElement;
              if (select?.value) handleSave(select.value);
            }}
            disabled={saving || !apiKey.trim()}
            className="shrink-0 rounded-lg bg-[var(--c-accent)] px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Section>

      {error && <div className="text-xs text-red-500">{error}</div>}
    </>
  );
}

// ---- Memory ----

function MemoryPane() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    api.getMemoryConfig().then(c => setEnabled(c.enabled));
  }, []);

  return (
    <Section>
      <SectionHeader>Memory</SectionHeader>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="size-4 rounded accent-[var(--c-accent)]"
        />
        <div>
          <div className="text-sm">Enable memory</div>
          <div className="text-xs text-[var(--c-text-secondary)]">
            Remember context across conversations (local storage)
          </div>
        </div>
      </label>
    </Section>
  );
}

// ---- Advanced ----

function AdvancedPane() {
  return (
    <>
      <Section>
        <SectionHeader>Data</SectionHeader>
        <div className="text-sm text-[var(--c-text-secondary)]">
          All data is stored locally in IndexedDB and localStorage.
          Clear browser data to reset.
        </div>
      </Section>
      <Section>
        <SectionHeader>Config Path</SectionHeader>
        <div className="text-sm font-mono text-[var(--c-text-secondary)]">~/.config/xiaok/</div>
      </Section>
    </>
  );
}
