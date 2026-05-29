import { useState, useEffect, useCallback } from 'react'
import { Brain, Plus, Upload, RefreshCw, Trash2, Search, Pencil, X } from 'lucide-react'
import { useLocale } from '../../contexts/LocaleContext'
import { getDesktopApi } from '../../shared/desktop'
import { Modal } from '../shared/Modal'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { secondaryButtonSmCls, secondaryButtonBorderStyle } from '../buttonStyles'

interface LayerStats {
  l0: number
  l1: number
  l2: number
  l3: number
  dbSizeBytes: number
}

interface MemoryEntryView {
  id: string
  content: string
  tags?: string[]
  createdAt?: string
  meta?: Record<string, unknown>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return ''
  // SQLite datetime('now') stores UTC without Z suffix — normalize before parsing
  let normalized = dateStr
  if (!normalized.includes('T') && !normalized.includes('Z') && !normalized.includes('+')) {
    normalized = normalized.replace(' ', 'T') + 'Z'
  } else if (normalized.includes('T') && !normalized.includes('Z') && !normalized.includes('+') && !normalized.includes('-', 11)) {
    normalized += 'Z'
  }
  const then = new Date(normalized).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  if (diffMs < 0) return '刚刚'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function LocalMemoryStatsCard() {
  const { t } = useLocale()
  const ds = t.desktopSettings

  const [stats, setStats] = useState<LayerStats | null>(null)
  const [entries, setEntries] = useState<MemoryEntryView[]>([])
  const [loading, setLoading] = useState(true)
  const [activeLayer, setActiveLayer] = useState(0)
  const [compacting, setCompacting] = useState(false)
  const [compactDone, setCompactDone] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [modelId, setModelId] = useState<string | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<MemoryEntryView | null>(null)

  // Add modal state
  const [addContent, setAddContent] = useState('')
  const [addTags, setAddTags] = useState('')

  // Import modal state
  const [importText, setImportText] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)

  // Edit modal state
  const [editContent, setEditContent] = useState('')
  const [editTags, setEditTags] = useState('')

  const api = getDesktopApi()
  const memoryApi = api?.memory as any

  const loadEntries = useCallback(async (layer: number) => {
    if (!memoryApi?.listLayer) return
    setLoading(true)
    try {
      const listResult = await memoryApi.listLayer(layer, 200, 0)
      setEntries(Array.isArray(listResult) ? listResult : [])
    } catch (err) {
      console.error('listLayer failed', err)
    } finally {
      setLoading(false)
    }
  }, [memoryApi])

  const loadData = useCallback(async () => {
    if (!memoryApi) { setLoading(false); return }
    setLoading(true)
    try {
      const [statsResult, listResult, mid] = await Promise.all([
        memoryApi.stats?.() ?? null,
        memoryApi.listLayer?.(activeLayer, 200, 0) ?? [],
        memoryApi.getModelId?.() ?? null,
      ])
      if (statsResult) setStats(statsResult)
      setEntries(Array.isArray(listResult) ? listResult : [])
      setModelId(mid ?? null)
    } catch (err) {
      console.error('LocalMemoryStatsCard loadData failed', err)
    } finally {
      setLoading(false)
    }
  }, [memoryApi, activeLayer])

  useEffect(() => { void loadData() }, [loadData])

  const handleCompact = useCallback(async () => {
    if (!memoryApi?.compact) return
    setCompacting(true)
    try {
      await memoryApi.compact()
      setCompactDone(true)
      setTimeout(() => setCompactDone(false), 2000)
      void loadData()
    } catch (err) {
      console.error('compact failed', err)
    } finally {
      setCompacting(false)
    }
  }, [memoryApi, loadData])

  const handleClearAll = useCallback(async () => {
    if (!memoryApi?.clearAll) return
    setClearConfirmOpen(false)
    try {
      await memoryApi.clearAll()
      void loadData()
    } catch (err) {
      console.error('clearAll failed', err)
    }
  }, [memoryApi, loadData])

  const handleDelete = useCallback(async (id: string) => {
    if (!memoryApi?.deleteEntry) return
    setDeleteConfirmId(null)
    try {
      await memoryApi.deleteEntry(id, activeLayer)
      void loadData()
    } catch (err) {
      console.error('deleteEntry failed', err)
    }
  }, [memoryApi, loadData, activeLayer])

  const handleAdd = useCallback(async () => {
    if (!memoryApi?.add || !addContent.trim()) return
    try {
      const tags = addTags.trim()
        ? addTags.split(',').flatMap(s => {
          const trimmed = s.trim()
          return trimmed ? [trimmed] : []
        })
        : undefined
      await memoryApi.add(addContent.trim(), tags?.[0])
      setAddContent('')
      setAddTags('')
      setAddModalOpen(false)
      void loadData()
    } catch (err) {
      console.error('add memory failed', err)
    }
  }, [memoryApi, addContent, addTags, loadData])

  const handleImport = useCallback(async () => {
    if (!memoryApi?.add || !importText.trim()) return
    try {
      let items: { content: string; tags?: string[] }[] = []
      const trimmed = importText.trim()

      // Try JSON array
      if (trimmed.startsWith('[')) {
        try {
          items = JSON.parse(trimmed)
        } catch { /* fall through */ }
      }

      // Try JSON Lines
      if (items.length === 0 && trimmed.includes('\n')) {
        const lines = trimmed.split('\n').filter(l => l.trim())
        const jsonLines = lines.every(l => l.trim().startsWith('{'))
        if (jsonLines) {
          items = lines.flatMap(l => {
            try {
              return [JSON.parse(l)]
            } catch {
              return []
            }
          })
        }
      }

      // Try markdown list
      if (items.length === 0) {
        const lines = trimmed.split('\n').filter(l => l.trim())
        if (lines.every(l => /^[-*]\s/.test(l.trim()))) {
          items = lines.map(l => ({ content: l.replace(/^[-*]\s+/, '').trim() }))
        }
      }

      // Plain text lines
      if (items.length === 0) {
        items = trimmed.split('\n').filter(l => l.trim()).map(l => ({ content: l.trim() }))
      }

      let imported = 0
      for (const item of items) {
        if (item.content?.trim()) {
          await memoryApi.add(item.content, item.tags?.[0])
          imported++
        }
      }
      setImportResult(`导入 ${imported} 条记忆`)
      setImportText('')
      void loadData()
      setTimeout(() => { setImportResult(null); setImportModalOpen(false) }, 1500)
    } catch (err) {
      console.error('import failed', err)
      setImportResult('导入失败')
    }
  }, [memoryApi, importText, loadData])

  const handleEdit = useCallback(async () => {
    if (!editingEntry || !memoryApi?.deleteEntry || !memoryApi?.add) return
    try {
      await memoryApi.deleteEntry(editingEntry.id, 0)
      const tags = editTags.trim()
        ? editTags.split(',').flatMap(s => {
          const trimmed = s.trim()
          return trimmed ? [trimmed] : []
        })
        : undefined
      await memoryApi.add(editContent.trim(), tags?.[0])
      setEditingEntry(null)
      void loadData()
    } catch (err) {
      console.error('edit failed', err)
    }
  }, [editingEntry, editContent, editTags, memoryApi, loadData])

  const handleModelChange = useCallback(async (value: string) => {
    if (!memoryApi?.setModelId) return
    const id = value === '__default__' ? null : value
    await memoryApi.setModelId(id)
    setModelId(id)
  }, [memoryApi])

  // Filter entries by search query
  const filteredEntries = searchQuery.trim()
    ? entries.filter(e =>
        e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.tags ?? []).some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : entries

  return (
    <div className="flex flex-col gap-4">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-[var(--c-text-secondary)]" />
          <h4 className="text-sm font-semibold text-[var(--c-text-heading)]">{ds.memoryLocalTitle}</h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            <Plus size={14} />
            {ds.memoryAdd}
          </button>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            <Upload size={14} />
            {ds.memoryImport}
          </button>
          <button
            type="button"
            onClick={handleCompact}
            disabled={compacting}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            <RefreshCw size={14} className={compacting ? 'animate-spin' : ''} />
            {compactDone ? ds.memoryCompactDone : ds.memoryCompact}
          </button>
          <button
            type="button"
            onClick={() => setClearConfirmOpen(true)}
            className={secondaryButtonSmCls}
            style={{ border: '0.5px solid var(--c-border-subtle)', color: 'var(--c-status-error, #ef4444)' }}
          >
            <Trash2 size={14} />
            {ds.memoryClear}
          </button>
        </div>
      </div>

      {/* Layer stats */}
      {stats && (
        <div
          className="grid grid-cols-4 gap-0 rounded-xl"
          style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-menu)' }}
        >
          {([
            { layer: 0, count: stats.l0, label: ds.memoryLayerL0 },
            { layer: 1, count: stats.l1, label: ds.memoryLayerL1 },
            { layer: 2, count: stats.l2, label: ds.memoryLayerL2 },
            { layer: 3, count: stats.l3, label: ds.memoryLayerL3 },
          ] as const).map(({ layer, count, label }) => (
            <div
              key={layer}
              role="button"
              tabIndex={0}
              onClick={() => { setActiveLayer(layer); void loadEntries(layer) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveLayer(layer); void loadEntries(layer) } }}
              className="flex cursor-pointer flex-col items-center py-4 transition-colors hover:bg-[var(--c-bg-deep)]/30"
              style={{
                borderBottom: activeLayer === layer ? '2px solid var(--c-text-heading)' : '2px solid transparent',
                borderRadius: layer === 0 ? '0.75rem 0 0 0.75rem' : layer === 3 ? '0 0.75rem 0.75rem 0' : undefined,
              }}
            >
              <div className="text-2xl font-bold text-[var(--c-text-heading)]">{count}</div>
              <div className="text-xs text-[var(--c-text-muted)]">{label}</div>
              {layer === 1 && <div className="mt-1 text-[10px] text-[var(--c-text-muted)]">{formatBytes(stats.dbSizeBytes)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Compression model selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--c-text-secondary)]">{ds.memoryCompactionModel}:</span>
        <select
          value={modelId ?? '__default__'}
          onChange={(e) => void handleModelChange(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-sm"
          style={{
            border: '1px solid var(--c-border-subtle)',
            background: 'var(--c-bg-input)',
            color: 'var(--c-text-primary)',
          }}
        >
          <option value="__default__">{ds.memoryCompactionModelDefault}</option>
          <option value="gpt-4o-mini">gpt-4o-mini</option>
          <option value="gpt-4o">gpt-4o</option>
          <option value="deepseek-chat">deepseek-chat</option>
        </select>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-xl px-4 py-3"
        style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)' }}
      >
        <Search size={16} className="shrink-0 text-[var(--c-text-muted)]" />
        <input aria-label={ds.memorySearch}
          type="text"
          placeholder={ds.memorySearch}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-[var(--c-text-primary)] outline-none placeholder:text-[var(--c-text-muted)]"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} className="text-[var(--c-text-muted)] hover:text-[var(--c-text-primary)]">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Memory entries list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <RefreshCw size={16} className="animate-spin text-[var(--c-text-muted)]" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <div
          className="rounded-xl py-8 text-center text-sm text-[var(--c-text-muted)]"
          style={{ border: '1px dashed var(--c-border-subtle)' }}
        >
          {searchQuery ? ds.memoryNoMatch : ds.memoryEmpty}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="group rounded-xl px-4 py-3"
              style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-menu)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--c-text-primary)]">{entry.content}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {entry.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex rounded-md px-2 py-0.5 text-[11px]"
                        style={{ border: '1px solid var(--c-border-subtle)', color: 'var(--c-text-secondary)' }}
                      >
                        {tag}
                      </span>
                    ))}
                    {entry.createdAt && (
                      <span className="text-[11px] text-[var(--c-text-muted)]">
                        {formatTimeAgo(entry.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEntry(entry)
                      setEditContent(entry.content)
                      setEditTags(entry.tags?.join(', ') ?? '')
                    }}
                    className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-elevated)] hover:text-[var(--c-text-primary)]"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(entry.id)}
                    className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-elevated)] hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={addModalOpen} onClose={() => setAddModalOpen(false)} title={ds.memoryAdd} width="480px">
        <div className="flex flex-col gap-3">
          <textarea aria-label={ds.memoryAddPlaceholder}
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder={ds.memoryAddPlaceholder}
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)', color: 'var(--c-text-primary)', resize: 'vertical' }}
          />
          <input aria-label={ds.memoryTagsPlaceholder}
            type="text"
            value={addTags}
            onChange={(e) => setAddTags(e.target.value)}
            placeholder={ds.memoryTagsPlaceholder}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)', color: 'var(--c-text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!addContent.trim()}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            {ds.memorySave}
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModalOpen} onClose={() => { setImportModalOpen(false); setImportResult(null) }} title={ds.memoryImport} width="520px">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--c-text-muted)]">{ds.memoryImportDesc}</p>
          <textarea aria-label={ds.memoryImportPlaceholder}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={ds.memoryImportPlaceholder}
            rows={8}
            className="w-full rounded-lg px-3 py-2 text-xs font-mono"
            style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)', color: 'var(--c-text-primary)', resize: 'vertical' }}
          />
          {importResult && (
            <p className="text-xs text-green-500">{importResult}</p>
          )}
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={!importText.trim()}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            {ds.memoryImportBtn}
          </button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editingEntry} onClose={() => setEditingEntry(null)} title="编辑记忆" width="480px">
        <div className="flex flex-col gap-3">
          <textarea
            aria-label="编辑记忆"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)', color: 'var(--c-text-primary)', resize: 'vertical' }}
          />
          <input aria-label={ds.memoryTagsPlaceholder}
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder={ds.memoryTagsPlaceholder}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--c-border-subtle)', background: 'var(--c-bg-input)', color: 'var(--c-text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void handleEdit()}
            disabled={!editContent.trim()}
            className={secondaryButtonSmCls}
            style={secondaryButtonBorderStyle}
          >
            {ds.memorySave}
          </button>
        </div>
      </Modal>

      {/* Clear confirm */}
      <ConfirmDialog
        open={clearConfirmOpen}
        title={ds.memoryClearConfirmTitle}
        message={ds.memoryClearConfirmDesc}
        confirmLabel={ds.memoryClearConfirmBtn}
        cancelLabel={ds.memoryCancel}
        onConfirm={() => void handleClearAll()}
        onClose={() => setClearConfirmOpen(false)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        title={ds.memoryDeleteConfirm}
        message=""
        confirmLabel={ds.memoryClear}
        cancelLabel={ds.memoryCancel}
        onConfirm={() => { if (deleteConfirmId) void handleDelete(deleteConfirmId) }}
        onClose={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
