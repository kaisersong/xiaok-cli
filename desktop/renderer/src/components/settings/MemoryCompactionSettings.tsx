import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../../contexts/LocaleContext'
import { getDesktopApi } from '../../shared/desktop'
import { ModelConfigurationCard } from './ModelConfigurationCard'
import { ModelActionsMenu } from './ModelActionsMenu'
import { ModelInfoButton } from './ModelInfoButton'
import type { MemorySettingsSnapshot } from '../../../../shared/memory-settings-types'

export function MemoryCompactionSettings({ active = true }: { active?: boolean } = {}) {
  const { t } = useLocale(); const ds = t.desktopSettings
  const memory = getDesktopApi()?.memory
  const [settings, setSettings] = useState<MemorySettingsSnapshot | null>(null)
  const [busy, setBusy] = useState(true); const [error, setError] = useState(false)
  const saving = useRef(false)
  useEffect(() => {
    let mounted = true
    void memory?.getSettings?.().then(value => { if (mounted) setSettings(value) })
      .catch(() => { if (mounted) setError(true) }).finally(() => { if (mounted) setBusy(false) })
    if (!memory?.getSettings) { setBusy(false); setError(true) }
    return () => { mounted = false }
  }, [memory])
  const save = async (next: string | null) => {
    if (saving.current || !memory || (next === settings?.compactionModelId && !settings?.warning)) return
    saving.current = true; setBusy(true); setError(false)
    try {
      if (await memory.setModelId(next) !== true) throw new Error('setting_failed')
      setSettings(await memory.getSettings())
    } catch { setError(true) }
    finally { saving.current = false; setBusy(false) }
  }
  const model = settings?.compactionModelId ?? null
  const choices = [{ ...settings?.defaultCompactionModel, id: null, label: ds.memoryCompactionModelDefault }, ...(settings?.compactionModels ?? [])]
  const selected = choices.find(c => c.id === model)
  const label = choices.find(c => c.id === model)?.label ?? model ?? ds.memoryCompactionModelDefault
  const actions = choices.map(c => ({ key: c.id ?? 'default', label: c.label, checked: model === c.id,
    description: c.eligible ? ds.memoryCompactionCapabilitySource(c.source ?? '') : ds.memoryCompactionCapabilityReason(c.reason ?? 'unknown_capability'),
    disabled: busy || !c.eligible || (model === c.id && !settings?.warning), onSelect: () => void save(c.id) }))
  return <section className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-menu)] p-4 flex flex-col gap-3">
    <div className="flex items-center gap-1.5"><h4 className="text-sm font-semibold">{ds.memoryCompactionModel}</h4>
      <ModelInfoButton title={ds.memoryCompactionHelpTitle} active={active}>
        <p>{ds.memoryCompactionModelDesc}</p><p>{ds.memoryCompactionSelectionGuide}</p><p>{ds.memoryCompactionQualityNote}</p>
        {settings?.compactionModels.some(c => c.reason === 'unknown_capability') && <p>{ds.memoryCompactionCapabilityHelp}</p>}
      </ModelInfoButton>
    </div>
    <ModelConfigurationCard name={ds.memoryCompactionModel} description={label} status={busy ? t.loading : selected?.eligible ? ds.memoryCompactionEligible : ds.memoryCompactionCapabilityReason(selected?.reason ?? 'unknown_capability')}
      selected actions={actions} active={active} primary={<ModelActionsMenu label={ds.memoryCompactionModel} triggerText={ds.modelConfigChange} items={actions} active={active} disabled={busy || !settings} />} />
    {settings && <p className="text-xs text-[var(--c-text-muted)]">{ds.memoryCompactionContext(selected?.contextLimit ?? null)}</p>}
    {settings?.warning && <p role="alert" className="text-xs text-amber-600">{ds.memoryCompactionConfigWarning}</p>}
    {error && <p role="alert" className="text-xs text-red-500">{ds.modelConfigError}</p>}
  </section>
}
