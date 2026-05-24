import { useState, useEffect } from 'react'
import { Download, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

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

  if (loading) return <div className="text-sm text-[var(--c-text-muted)]">加载中...</div>

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-[var(--c-text-secondary)]">向量化模型</div>
      <p className="text-xs text-[var(--c-text-muted)]">选择本地向量化模型。点击即可下载并切换。</p>

      <div className="mt-2 space-y-1">
        {models.map(model => {
          const dl = downloadState?.modelId === model.id ? downloadState : null
          const isExpanded = expandedId === model.id
          const isDownloading = dl?.status === 'downloading'

          return (
            <div key={model.id}>
              <div
                onClick={() => !isDownloading && handleRowClick(model)}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  model.active
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5'
                    : 'border-[var(--c-border-subtle)] hover:border-[var(--c-accent)]/40 cursor-pointer'
                } ${isDownloading ? 'opacity-70 pointer-events-none' : ''}`}
              >
                {/* Radio indicator */}
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    model.active
                      ? 'border-[var(--c-accent)]'
                      : 'border-[var(--c-text-muted)]'
                  }`}
                >
                  {model.active && (
                    <div className="h-2 w-2 rounded-full bg-[var(--c-accent)]" />
                  )}
                </div>

                {/* Model info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-primary)]">{model.name}</span>
                    <span className="text-[10px] text-[var(--c-text-muted)]">{model.size} · {model.dims}维</span>
                  </div>
                  <div className="text-xs text-[var(--c-text-muted)]">{model.languages}</div>
                </div>

                {/* Status */}
                <div className="flex shrink-0 items-center gap-2">
                  {isDownloading ? (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--c-text-muted)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>下载中…</span>
                    </span>
                  ) : model.downloaded ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="h-3.5 w-3.5" />
                      <span>已下载</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--c-text-muted)]">
                      <Download className="h-3.5 w-3.5" />
                      <span>点击下载</span>
                    </span>
                  )}

                  {!model.downloaded && !isDownloading && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : model.id) }}
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"
                      title="手动下载指引"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
                  <div className="font-medium text-[var(--c-text-primary)]">手动下载指引</div>
                  <div>1. 浏览器打开以下链接下载文件：</div>
                  {model.manualHint.urls.map(u => (
                    <div key={u.file} className="pl-3 break-all">
                      <span className="text-[var(--c-text-primary)]">{u.file}</span>：{u.url}
                    </div>
                  ))}
                  <div>2. 将文件放入目录：</div>
                  <div className="pl-3 rounded bg-[var(--c-bg-base)] px-2 py-1 font-mono text-[var(--c-text-primary)]">{model.manualHint.targetDir}</div>
                  <div>3. 放好后刷新此页面即可</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmModel(null)}>
          <div className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-5 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-medium text-[var(--c-text-primary)] mb-2">
              {confirmModel.downloaded ? '切换模型' : '下载并切换模型'}
            </div>
            <div className="text-xs text-[var(--c-text-secondary)] mb-4">
              {confirmModel.downloaded
                ? `确定切换到「${confirmModel.name}」？`
                : `确定下载并切换到「${confirmModel.name}」？（约 ${confirmModel.size}）`}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmModel(null)}
                className="rounded-md border border-[var(--c-border-subtle)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white hover:opacity-90"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
