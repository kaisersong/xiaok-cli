import { useState, useEffect } from 'react'
import { Download, Check, Loader2, Info } from 'lucide-react'

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
  const [tipsOpen, setTipsOpen] = useState<string | null>(null)

  useEffect(() => { loadModels() }, [])

  async function loadModels() {
    const result = await window.electronAPI.getEmbeddingModels()
    setModels(result)
    setLoading(false)
  }

  async function handleDownload(modelId: string) {
    setDownloadState({ modelId, status: 'downloading' })
    try {
      await window.electronAPI.downloadEmbeddingModel(modelId)
      setDownloadState({ modelId, status: 'done' })
      await loadModels()
    } catch (err) {
      setDownloadState({ modelId, status: 'error', error: (err as Error).message })
    }
  }

  async function handleSwitch(modelId: string) {
    await window.electronAPI.setEmbeddingModel(modelId)
    await loadModels()
  }

  if (loading) return <div className="text-sm text-[var(--c-text-muted)]">加载中...</div>

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-[var(--c-text-secondary)]">向量化模型</div>
      {models.map(model => {
        const dl = downloadState?.modelId === model.id ? downloadState : null
        return (
          <div key={model.id} className="rounded-lg border border-[var(--c-border-subtle)] p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {model.name}
                  {model.active && (
                    <span className="rounded-full bg-[var(--c-accent-primary)] px-2 py-0.5 text-xs text-white">
                      使用中
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-[var(--c-text-muted)]">
                  {model.size} · {model.dims} 维 · {model.languages}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {model.downloaded ? (
                  <>
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="h-3 w-3" /> 已下载
                    </span>
                    {!model.active && (
                      <button
                        onClick={() => handleSwitch(model.id)}
                        className="rounded-md bg-[var(--c-accent-primary)] px-3 py-1 text-xs text-white hover:opacity-90"
                      >
                        切换
                      </button>
                    )}
                  </>
                ) : dl?.status === 'downloading' ? (
                  <span className="flex items-center gap-1 text-xs text-[var(--c-text-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" /> 下载中...
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => handleDownload(model.id)}
                      className="flex items-center gap-1 rounded-md bg-[var(--c-accent-primary)] px-3 py-1 text-xs text-white hover:opacity-90"
                    >
                      <Download className="h-3 w-3" /> 下载
                    </button>
                    <button
                      onClick={() => setTipsOpen(tipsOpen === model.id ? null : model.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"
                      title="手动下载指引"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {dl?.status === 'error' && (
              <div className="mt-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800 whitespace-pre-line">
                {dl.error}
              </div>
            )}

            {tipsOpen === model.id && (
              <div className="mt-2 rounded-md bg-[var(--c-bg-deep)] p-3 text-xs text-[var(--c-text-secondary)] space-y-1">
                <div className="font-medium text-[var(--c-text-primary)]">手动下载指引</div>
                <div>1. 浏览器打开以下链接下载文件：</div>
                {model.manualHint.urls.map(u => (
                  <div key={u.file} className="pl-4 break-all">
                    {u.file}: <span className="text-[var(--c-accent-primary)]">{u.url}</span>
                  </div>
                ))}
                <div>2. 将下载的文件放入以下目录：</div>
                <div className="pl-4 font-mono text-[var(--c-text-primary)]">{model.manualHint.targetDir}</div>
                <div>3. 放好后重新打开此页面即可看到「已下载」状态</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
