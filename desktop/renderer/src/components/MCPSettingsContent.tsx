import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import {
  checkMCPInstall,
  createMCPInstall,
  deleteMCPInstall,
  isApiError,
  listMCPInstalls,
  setWorkspaceMCPEnablement,
  updateMCPInstall,
  type MCPInstall,
} from '../api'
import { useLocale } from '../contexts/LocaleContext'
import {
  type FormState,
  type MCPCopy,
  buildRequest,
  emptyForm,
  formFromInstall,
} from './mcp/types'
import { MCPInstallList } from './mcp/MCPInstallList'
import { MCPFormModal } from './mcp/MCPFormModal'
import { MCPScanSection } from './mcp/MCPScanSection'

type Props = {
  accessToken: string
}

export function MCPSettingsContent({ accessToken }: Props) {
  const { t } = useLocale()
  const ds = t.desktopSettings

  const mp = ds.mcpPage
  const copy: MCPCopy = useMemo(() => ({
    add: mp.add,
    refresh: mp.refresh,
    scan: mp.scan,
    create: mp.create,
    save: mp.save,
    cancel: mp.cancel,
    delete: mp.delete,
    edit: mp.edit,
    recheck: mp.recheck,
    enable: mp.enable,
    disable: mp.disable,
    import: mp.import,
    scanning: mp.scanning,
    saving: mp.saving,
    loading: mp.loading,
    empty: mp.empty,
    sourceEmpty: mp.discoveryEmpty,
    formTitleCreate: mp.formTitleCreate,
    formTitleEdit: mp.formTitleEdit,
    scanTitle: mp.scanTitle,
    externalTitle: mp.externalTitle,
    fieldName: mp.fieldName,
    fieldTransport: mp.fieldTransport,
    fieldHost: mp.fieldHost,
    fieldURL: mp.fieldUrl,
    fieldCommand: mp.fieldCommand,
    fieldArgs: mp.fieldArgs,
    fieldCwd: mp.fieldCwd,
    fieldEnv: mp.fieldEnv,
    fieldHeaders: mp.fieldHeaders,
    fieldToken: mp.fieldBearer,
    fieldTimeout: mp.fieldTimeout,
    fieldFilePath: mp.fieldDiscoveryPath,
    placeholderFilePath: mp.placeholderFilePath,
    errorName: mp.errRequired,
    errorURL: mp.errUrlRequired,
    errorCommand: mp.errCommandRequired,
    errorTimeout: mp.errTimeoutInvalid,
    errorEnv: mp.errEnvInvalid,
    errorHeaders: mp.errHeadersInvalid,
    toastLoadFailed: mp.toastLoadFailed,
    toastSaveFailed: mp.toastSaveFailed,
    toastDeleteFailed: mp.toastDeleteFailed,
    toastCheckFailed: mp.toastCheckFailed,
    toastToggleFailed: mp.toastToggleFailed,
    toastScanFailed: mp.toastDiscoverFailed,
    toastImportFailed: mp.toastImportFailed,
    toastSaved: mp.toastSaved,
    toastDeleted: mp.toastDeleted,
    toastChecked: mp.toastChecked,
    toastImported: mp.toastImported,
  }), [mp])

  const [installs, setInstalls] = useState<MCPInstall[]>([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MCPInstall | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyID, setBusyID] = useState<string | null>(null)
  const [menuID, setMenuID] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setMenuID(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadInstalls = useCallback(async () => {
    setLoading(true)
    try {
      const items = await listMCPInstalls(accessToken)
      setInstalls(items)
      setNotice(null)
    } catch {
      setNotice(copy.toastLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [accessToken, copy.toastLoadFailed])

  useEffect(() => { void loadInstalls() }, [loadInstalls])

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormError('')
  }, [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(emptyForm())
    setFormError('')
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((install: MCPInstall) => {
    setEditing(install)
    setForm(formFromInstall(install))
    setFormError('')
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => {
    if (saving) return
    setFormOpen(false)
    setEditing(null)
    setFormError('')
  }, [saving])

  const handleSave = useCallback(async () => {
    try {
      const req = buildRequest(form)
      setSaving(true)
      if (editing) {
        await updateMCPInstall(accessToken, editing.id, req)
      } else {
        await createMCPInstall(accessToken, req)
      }
      setNotice(copy.toastSaved)
      setFormOpen(false)
      setForm(emptyForm())
      setEditing(null)
      await loadInstalls()
    } catch (err) {
      if (isApiError(err)) {
        setFormError(err.message || copy.toastSaveFailed)
      } else if (err instanceof Error) {
        const map: Record<string, string> = {
          displayName: copy.errorName,
          url: copy.errorURL,
          command: copy.errorCommand,
          timeout: copy.errorTimeout,
          envJson: copy.errorEnv,
          headersJson: copy.errorHeaders,
        }
        const message = map[err.message] ?? err.message
        setFormError(message || copy.toastSaveFailed)
      } else {
        setFormError(copy.toastSaveFailed)
      }
    } finally {
      setSaving(false)
    }
  }, [accessToken, copy, editing, form, loadInstalls])

  const handleDelete = useCallback(async (install: MCPInstall) => {
    if (!window.confirm(`${copy.delete} "${install.display_name}"?`)) return
    setBusyID(install.id)
    try {
      await deleteMCPInstall(accessToken, install.id)
      setNotice(copy.toastDeleted)
      await loadInstalls()
    } catch {
      setNotice(copy.toastDeleteFailed)
    } finally {
      setBusyID(null)
    }
  }, [accessToken, copy.delete, copy.toastDeleteFailed, copy.toastDeleted, loadInstalls])

  const handleToggle = useCallback(async (install: MCPInstall) => {
    setBusyID(install.id)
    try {
      await setWorkspaceMCPEnablement(accessToken, {
        install_id: install.id,
        enabled: !install.workspace_state?.enabled,
      })
      await loadInstalls()
      setNotice(null)
    } catch {
      setNotice(copy.toastToggleFailed)
    } finally {
      setBusyID(null)
    }
  }, [accessToken, copy.toastToggleFailed, loadInstalls])

  const handleCheck = useCallback(async (install: MCPInstall) => {
    setBusyID(install.id)
    try {
      await checkMCPInstall(accessToken, install.id)
      setNotice(copy.toastChecked)
      await loadInstalls()
    } catch {
      setNotice(copy.toastCheckFailed)
    } finally {
      setBusyID(null)
    }
  }, [accessToken, copy.toastCheckFailed, copy.toastChecked, loadInstalls])

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--c-text-heading)]">{ds.mcpTitle}</h3>
          <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{ds.mcpDesc}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInstalls()}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)]"
            style={{ border: '0.5px solid var(--c-border-subtle)' }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {copy.refresh}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
            style={{ background: 'var(--c-btn-bg)', color: 'var(--c-btn-text)' }}
          >
            <Plus size={14} />
            {copy.add}
          </button>
        </div>
      </div>

      {/* notice */}
      {notice && (
        <div
          className="rounded-xl px-4 py-3 text-sm text-[var(--c-text-secondary)]"
          style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-menu)' }}
        >
          {notice}
        </div>
      )}

      {/* install list */}
      <MCPInstallList
        installs={installs}
        loading={loading}
        busyID={busyID}
        menuID={menuID}
        setMenuID={setMenuID}
        onEdit={openEdit}
        onDelete={(i) => void handleDelete(i)}
        onToggle={(i) => void handleToggle(i)}
        onCheck={(i) => void handleCheck(i)}
        copy={copy}
        menuRef={menuRef}
      />

      {/* scan & import */}
      <MCPScanSection
        accessToken={accessToken}
        copy={copy}
        onImported={async (installId) => {
          await loadInstalls()
          // auto-check after import
          try {
            await checkMCPInstall(accessToken, installId)
            await loadInstalls()
          } catch { /* check failure is non-blocking */ }
        }}
      />

      {/* create/edit modal */}
      <MCPFormModal
        open={formOpen}
        editing={!!editing}
        form={form}
        setField={setField}
        formError={formError}
        saving={saving}
        onSave={() => void handleSave()}
        onClose={closeForm}
        copy={copy}
      />
    </div>
  )
}
