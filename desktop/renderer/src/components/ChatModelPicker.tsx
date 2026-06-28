import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Cpu } from 'lucide-react';
import { api } from '../api';
import type {
  DesktopModelConfigSnapshot,
  DesktopModelEntryView,
  DesktopModelProviderView,
} from '../../../electron/preload-api';
import { useLocale } from '../contexts/LocaleContext';

interface ChatModelPickerProps {
  disabled?: boolean;
}

export function ChatModelPicker({ disabled }: ChatModelPickerProps) {
  const { t } = useLocale();
  const [config, setConfig] = useState<DesktopModelConfigSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadConfig = async () => {
    try {
      const snapshot = await api.getModelConfig();
      setConfig(snapshot);
    } catch {
      setConfig(null);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node)
        || btnRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentModel: DesktopModelEntryView | null = (() => {
    if (!config) return null;
    return (
      config.models.find((m) => m.id === config.defaultModelId)
      ?? config.models.find((m) => m.isDefault)
      ?? null
    );
  })();
  const currentProvider: DesktopModelProviderView | null = currentModel
    ? config?.providers.find((p) => p.id === currentModel.provider) ?? null
    : null;

  const buttonLabel = currentModel?.label ?? t.chatInput.modelPicker.empty;

  const handleOpen = () => {
    if (disabled || saving) return;
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuWidth = Math.max(rect.width, 240);
      setMenuStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
        width: menuWidth,
        zIndex: 9999,
      });
    }
    setOpen((v) => !v);
  };

  const handleSelect = async (model: DesktopModelEntryView) => {
    if (!config) return;
    if (config.defaultModelId === model.id) {
      setOpen(false);
      return;
    }
    setOpen(false);
    setSaving(true);
    try {
      const updated = await api.saveModelConfig({
        providerId: model.provider,
        modelId: model.id,
      });
      setConfig(updated);
    } catch {
      void loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const grouped = (() => {
    if (!config) return [] as Array<{ provider: DesktopModelProviderView; models: DesktopModelEntryView[] }>;
    const byProvider = new Map<string, DesktopModelEntryView[]>();
    for (const model of config.models) {
      const list = byProvider.get(model.provider) ?? [];
      list.push(model);
      byProvider.set(model.provider, list);
    }
    return config.providers
      .map((provider) => ({ provider, models: byProvider.get(provider.id) ?? [] }))
      .filter((g) => g.models.length > 0);
  })();

  const empty = !config || config.models.length === 0;

  const menu = open ? (
    <div
      ref={menuRef}
      className="dropdown-menu"
      style={{
        ...menuStyle,
        border: '0.5px solid var(--c-border-subtle)',
        borderRadius: '10px',
        padding: '4px',
        background: 'var(--c-bg-menu)',
        boxShadow: 'var(--c-dropdown-shadow)',
        maxHeight: '320px',
        overflowY: 'auto',
      }}
    >
      {empty ? (
        <div
          className="px-3 py-2 text-xs"
          style={{ color: 'var(--c-text-tertiary)' }}
        >
          {t.chatInput.modelPicker.empty}
        </div>
      ) : (
        grouped.map(({ provider, models }) => (
          <div key={provider.id} style={{ marginBottom: '4px' }}>
            <div
              className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--c-text-tertiary)' }}
            >
              {provider.label}
            </div>
            {models.map((model) => {
              const active = model.id === config?.defaultModelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => { void handleSelect(model); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm transition-colors bg-[var(--c-bg-menu)] hover:bg-[var(--c-bg-deep)]"
                  style={{
                    borderRadius: '8px',
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--c-text-heading)' : 'var(--c-text-secondary)',
                  }}
                >
                  <span className="truncate">{model.label}</span>
                  {active && (
                    <span
                      className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: 'var(--c-bg-deep)', color: 'var(--c-text-tertiary)' }}
                    >
                      {t.chatInput.modelPicker.activeBadge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || saving}
        onClick={handleOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={currentProvider ? `${currentProvider.label} · ${buttonLabel}` : t.chatInput.modelPicker.tooltip}
        aria-label={t.chatInput.modelPicker.tooltip}
        className="flex h-[26px] max-w-[180px] items-center gap-1 rounded-md px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          border: `0.5px solid ${hovered && !disabled ? 'var(--c-border-mid)' : 'var(--c-border-subtle)'}`,
          background: hovered && !disabled ? 'var(--c-bg-deep)' : 'transparent',
          color: 'var(--c-text-secondary)',
          transition: 'border-color 0.15s, background-color 0.15s',
        }}
      >
        <Cpu size={12} className="shrink-0 opacity-70" />
        <span className="truncate" style={{ fontWeight: 400 }}>{buttonLabel}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
