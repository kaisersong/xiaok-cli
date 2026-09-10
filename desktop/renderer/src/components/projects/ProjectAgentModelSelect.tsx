import { useEffect, useId, useState } from 'react';
import { Image } from 'lucide-react';
import { SettingsSelect } from '../settings/_SettingsSelect';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import type { DesktopModelConfigSnapshot } from '../../../../electron/preload-api';

export function ProjectAgentModelSelect({ value, onChange }: { value: string; onChange(value: string): void }) {
  const { t } = useLocale();
  const id = useId();
  const [config, setConfig] = useState<DesktopModelConfigSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api.getModelConfig().then(result => { if (active) setConfig(result); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const models = (config?.models ?? []).filter(model => model.projectAgentSelectable !== false);
  const current = models.find(model => model.id === (config?.configuredDefaultModelId ?? config?.defaultModelId));
  const visionIcon = (capabilities?: string[]) => capabilities?.includes('image_in')
    ? <span className="inline-flex shrink-0 text-[var(--c-text-muted)]" title={t.projectsAgentModelVision}><Image size={14} role="img" aria-label={t.projectsAgentModelVision} /></span>
    : undefined;
  const options = [
    { value: '', label: `${t.projectsAgentModelFollowCurrent}${current ? ` · ${current.label}` : ''}`, icon: visionIcon(current?.capabilities) },
    ...(value && !models.some(model => model.id === value) ? [{ value, label: `${value} · ${t.projectsAgentModelUnavailable}` }] : []),
    ...models.map(model => ({ value: model.id, label: model.label, icon: visionIcon(model.capabilities) })),
  ];
  return <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentModelLabel}</label>
    <SettingsSelect id={id} value={value} options={options} onChange={onChange} />
    <p className="text-[11px] text-[var(--c-text-muted)]">{failed ? t.projectsAgentModelLoadFailed : t.projectsAgentModelFallbackHint}</p>
  </div>;
}
