import { useState, useEffect } from 'react'
import { Download, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useLocale } from '../../contexts/LocaleContext'

interface ModelEntry {
  id: string
  name: string
  dims: number
  size: string
  languages: string
  downloaded: boolean
  active: boolean
  manualHint: { urls: { file: string; url: string }[]; targetDir: string }
}

type DownloadState = { modelId: string; status: 'downloading' | 'done' | 'error'; error?: string } | null

export function MemoryModelSettings() {
  const { t } = useLocale()
  const ds = t.desktopSettings
  const [models, setModels] = useState<ModelEntry[]>([])
  const [downloadState, setDownloadState] = useState<DownloadState>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmModel, setConfirmModel] = useState<ModelEntry | null>(null)

  useEffect(() => { loadModels() }, [])

  async function loadModels() {
    const result = await window.xiaokDesktop.getEmbeddingModels()
    setModels(result)
    setLoading(false)
  }

  function handleRowClick(model: ModelEntry) {
    if (model.active) return
    setConfirmModel(model)
  }

  async function handleConfirm() {
    const model = confirmModel
    if (!model) return
    setConfirmModel(null)

    if (model.downloaded) {
      await window.xiaokDesktop.setEmbeddingModel(model.id)
      await loadModels()
    } else {
      setDownloadState({ modelId: model.id, status: 'downloading' })
      try {
        await window.xiaokDesktop.downloadEmbeddingModel(model.id)
        await window.xiaokDesktop.setEmbeddingModel(model.id)
        setDownloadState({ modelId: model.id, status: 'done' })
        await loadModels()
      } catch (err) {
        setDownloadState({ modelId: model.id, status: 'error', error: (err as Error).message })
      }
    }
  }

  if (loading) return <div className="text-sm text-[var(--c-text-muted)]">{t.loading}</div>

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-[var(--c-text-secondary)]">{ds.embeddingModelTitle}</div>
      <p className="text-xs text-[var(--c-text-muted)]">{ds.embeddingModelDesc}</p>

      <div className="mt-2 space-y-1">
        {models.map(model => {
          const dl = downloadState?.modelId === model.id ? downloadState : null
          const isExpanded = expandedId === model.id
          const isDownloading = dl?.status === 'downloading'

          return (
            <div key={model.id}>
              <div
                role="button"
                tabIndex={isDownloading ? -1 : 0}
                aria-label={model.name}
                onClick={() => !isDownloading && handleRowClick(model)}
                onKeyDown={(e) => { if (!isDownloading && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleRowClick(model); } }}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  model.active
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5'
                    : 'border-[var(--c-border-subtle)] hover:border-[var(--c-accent)]/40 cursor-pointer'
                } ${isDownloading ? 'opacity-70 pointer-events-none' : ''}`}
              >
                {/* Radio indicator */}
                <div
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    model.active
                      ? 'border-[var(--c-accent)]'
                      : 'border-[var(--c-text-muted)]'
                  }`}
                >
                  {model.active && (
                    <div className="size-2 rounded-full bg-[var(--c-accent)]" />
                  )}
                </div>

                {/* Model info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-primary)]">{model.name}</span>
                    <span className="text-[10px] text-[var(--c-text-muted)]">{model.size} · {ds.embeddingModelDims(model.dims)}</span>
                  </div>
                  <div className="text-xs text-[var(--c-text-muted)]">{model.languages}</div>
                </div>

                {/* Status */}
                <div className="flex shrink-0 items-center gap-2">
                  {isDownloading ? (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--c-text-muted)]">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>{ds.embeddingModelDownloading}</span>
                    </span>
                  ) : model.downloaded ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="size-3.5" />
                      <span>{ds.embeddingModelDownloaded}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--c-text-muted)]">
                      <Download className="size-3.5" />
                      <span>{ds.embeddingModelClickToDownload}</span>
                    </span>
                  )}

                  {!model.downloaded && !isDownloading && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : model.id) }}
                      className="flex size-6 items-center justify-center rounded text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"
                      title={ds.embeddingModelManualGuideTitle}
                    >
                      {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              {dl?.status === 'error' && (
                <div className="mt-1 ml-7 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 whitespace-pre-line">
                  {dl.error}
                </div>
              )}

              {isExpanded && (
                <div className="mt-1 ml-7 rounded-md bg-[var(--c-bg-deep)] p-3 text-xs text-[var(--c-text-secondary)] space-y-1.5">
                  <div className="font-medium text-[var(--c-text-primary)]">{ds.embeddingModelManualGuideTitle}</div>
                  <div>{ds.embeddingModelManualStep1}</div>
                  {model.manualHint.urls.map(u => (
                    <div key={u.file} className="pl-3 break-all">
                      <span className="text-[var(--c-text-primary)]">{u.file}</span>：{u.url}
                    </div>
                  ))}
                  <div>{ds.embeddingModelManualStep2}</div>
                  <div className="pl-3 rounded bg-[var(--c-bg-base)] px-2 py-1 font-mono text-[var(--c-text-primary)]">{model.manualHint.targetDir}</div>
                  <div>{ds.embeddingModelManualStep3}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmModel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="presentation"
          onClick={() => setConfirmModel(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmModel(null); }}
        >
          <div className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-5 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-medium text-[var(--c-text-primary)] mb-2">
              {confirmModel.downloaded ? ds.embeddingModelSwitchTitle : ds.embeddingModelDownloadAndSwitchTitle}
            </div>
            <div className="text-xs text-[var(--c-text-secondary)] mb-4">
              {confirmModel.downloaded
                ? ds.embeddingModelSwitchConfirm(confirmModel.name)
                : ds.embeddingModelDownloadAndSwitchConfirm(confirmModel.name, confirmModel.size)}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button"
                onClick={() => setConfirmModel(null)}
                className="rounded-md border border-[var(--c-border-subtle)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                {ds.embeddingModelCancel}
              </button>
              <button type="button"
                onClick={handleConfirm}
                className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white hover:opacity-90"
              >
                {ds.embeddingModelConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
