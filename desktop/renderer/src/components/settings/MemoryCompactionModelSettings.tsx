import { useEffect, useState } from 'react'
import { useLocale } from '../../contexts/LocaleContext'
import { getDesktopApi } from '../../shared/desktop'

export function MemoryCompactionModelSettings() {
  const { t } = useLocale()
  const ds = t.desktopSettings
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const api = getDesktopApi()

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [modelId, config] = await Promise.all([
          api?.memory?.getModelId?.() ?? null,
          api?.getModelConfig?.() ?? null,
        ])
        if (!active) return
        const options = config?.models ?? []
        setModels(options)
        setSelected(modelId && options.some(model => model.id === modelId) ? modelId : null)
      } catch { if (active) setError(true) }
      finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [api])

  async function save(value: string) {
    if (!api?.memory?.setModelId) return
    const next = value === '__default__' ? null : value
    setBusy(true)
    setError(false)
    try {
      if (!await api.memory.setModelId(next)) throw new Error('memory_model_save_failed')
      setSelected(next)
    } catch { setError(true) }
    finally { setBusy(false) }
  }

  return <div className="space-y-2">
    <label className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
      {ds.memoryCompactionModel}
      <select aria-label={ds.memoryCompactionModel} value={selected ?? '__default__'}
        disabled={busy} onChange={event => void save(event.target.value)}
        className="rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-1.5 text-[var(--c-text-primary)]">
        <option value="__default__">{ds.memoryCompactionModelDefault}</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-xs text-[var(--c-status-error)]">{ds.memoryModelConfigFailed}</p>}
  </div>
}
