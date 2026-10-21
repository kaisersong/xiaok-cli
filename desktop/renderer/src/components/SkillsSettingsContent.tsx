import { useSkillListReadonly, useSkillStatsReadonly } from '../hooks/useSkillReadonly';
import { mapInstalledSkillList, mapPlatformSkillList } from '../api/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Github,
  Loader2,
  PackagePlus,
  Search,
  Upload,
} from 'lucide-react'
import { Modal } from './shared/Modal'
import { DirectionAwareTabs } from './ui/direction-aware-tabs'
import {
  type InstalledSkill,
  type MarketSkill,
  type SkillImportCandidate,
  type SkillPackageResponse,
  type SkillReference,
  deleteSkill,
  importRegistrySkill,
  importSkillFromGitHub,
  importSkillFromUpload,
  installSkill,
  isApiError,
  listDefaultSkills,
  listInstalledSkills,
  listPlatformSkills,
  type PlatformSkillItem,
  replaceDefaultSkills,
  searchMarketSkills,
  setPlatformSkillOverride,
} from '../api'
import { useLocale } from '../contexts/LocaleContext'
import type { CandidateState, ViewMode, ViewSkill } from './skills/types'
import { asSkillRef, dedupeSkillRefs, mergeSkills } from './skills/types'
import { DropdownAction } from './skills/DropdownAction'
import { InstalledSkillsView } from './skills/InstalledSkillsView'
import { MarketplaceView } from './skills/MarketplaceView'
import { BuiltinSkillsView } from './skills/BuiltinSkillsView'
import { SkillDetailModal } from './skills/SkillDetailModal'
import { primaryButtonSmCls, secondaryButtonBorderStyle, secondaryButtonSmCls } from './buttonStyles'
import { api } from '../api'

type SkillActionErrorKey = 'importFailed' | 'repositoryMissing' | 'deleteConflict' | 'disableFailed' | 'githubInvalidUrl' | 'githubSkillNotFound'
type SkillAction = { lifetime: object }

type Props = {
  accessToken: string
  onTrySkill?: (prompt: string) => void
}

export function SkillsSettingsContent({ accessToken, onTrySkill }: Props) {
  const { t, locale } = useLocale()
  const skillText = t.skills
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('installed')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [menuSkillId, setMenuSkillId] = useState<string | null>(null)
  const listFacts = useSkillListReadonly(), statFacts = useSkillStatsReadonly()
  const installedSkills = useMemo(() => mapInstalledSkillList(listFacts.data ?? []), [listFacts.data])
  const [defaultSkills, setDefaultSkills] = useState<InstalledSkill[]>([])
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(false)
  const [officialDisabled, setOfficialDisabled] = useState(false)
  const [error, setRawError] = useState('')
  const [actionErrorKey, setActionErrorKey] = useState<SkillActionErrorKey | null>(null)
  const setError = useCallback((message: string) => { setActionErrorKey(null); setRawError(message) }, [])
  const setActionError = useCallback((key: SkillActionErrorKey) => { setRawError(''); setActionErrorKey(key) }, [])
  const visibleError = actionErrorKey ? skillText[actionErrorKey] : error
  const [busySkillId, setBusySkillId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [githubOpen, setGitHubOpen] = useState(false)
  const [candidateState, setCandidateState] = useState<CandidateState | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [installAfterImport, setInstallAfterImport] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [githubUrl, setGitHubUrl] = useState('')
  const [githubRef, setGitHubRef] = useState('')
  const [importing, setImporting] = useState(false)
  const [detailSkill, setDetailSkill] = useState<ViewSkill | null>(null)
  const [builtinOverride, setBuiltinSkills] = useState<PlatformSkillItem[] | null>(null)
  const builtinSkills = builtinOverride ?? mapPlatformSkillList(listFacts.data ?? [])
  const [builtinLoading, setBuiltinLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const cardMenuRef = useRef<HTMLDivElement>(null)
  const statsMap = new Map((statFacts.data ?? []).map(s => [s.skillName, s]))
  const actionLifetime = useRef<object | null>(null)
  const actionFlight = useRef<SkillAction | null>(null)
  const defaultRevision = useRef(0)
  const currentDefaults = useRef(defaultSkills)
  currentDefaults.current = defaultSkills
  useEffect(() => {
    const lifetime = {}
    actionLifetime.current = lifetime
    actionFlight.current = null
    defaultRevision.current += 1
    setBusySkillId(null); setImporting(false); setUploading(false)
    return () => {
      if (actionLifetime.current === lifetime) actionLifetime.current = null
      if (actionFlight.current?.lifetime === lifetime) actionFlight.current = null
    }
  }, [accessToken])
  // One page-owned default writer. Locale changes do not invalidate authorized work.
  const beginAction = useCallback((): SkillAction | null => {
    if (!actionLifetime.current || actionFlight.current) return null
    const action = { lifetime: actionLifetime.current }
    actionFlight.current = action
    return action
  }, [])
  const isCurrentAction = useCallback((action: SkillAction) =>
    actionLifetime.current === action.lifetime && actionFlight.current === action, [])
  const finishAction = useCallback((action: SkillAction) => {
    if (!isCurrentAction(action)) return false
    actionFlight.current = null
    return true
  }, [isCurrentAction])
  const catalogPending = useRef<Promise<import('../../../shared/skill-list-ipc-contract').SkillListDto> | null>(null)
  const refreshCatalog = useCallback(async () => {
    if (catalogPending.current) return catalogPending.current
    const pending = listFacts.reload(); catalogPending.current = pending
    try { return await pending } finally { if (catalogPending.current === pending) catalogPending.current = null }
  }, [listFacts.reload])
  const refreshBuiltin = useCallback(async () => {
    const lifetime = actionLifetime.current
    const snapshot = await refreshCatalog(); const items = mapPlatformSkillList(snapshot)
    if (lifetime && actionLifetime.current === lifetime) setBuiltinSkills(items)
    return items
  }, [refreshCatalog])
  const refreshInstalled = useCallback(async () => {
    const lifetime = actionLifetime.current, revision = defaultRevision.current
    const [snapshot, defaults] = await Promise.all([refreshCatalog(), listDefaultSkills(accessToken)])
    if (lifetime && actionLifetime.current === lifetime && defaultRevision.current === revision) setDefaultSkills(defaults)
    return { installed: mapInstalledSkillList(snapshot), defaults }
  }, [refreshCatalog, accessToken])
  useEffect(() => { setLoading(listFacts.reading && listFacts.data === null) }, [listFacts.reading, listFacts.data])
  useEffect(() => {
    let active = true
    const revision = defaultRevision.current
    void listDefaultSkills(accessToken).then(defaults => { if (active && revision === defaultRevision.current) setDefaultSkills(defaults) }).catch(() => {})
    return () => { active = false }
  }, [accessToken])
  useEffect(() => { setBuiltinSkills(null) }, [listFacts.data])

  useEffect(() => {
    if (viewMode !== 'marketplace') {
      setMarketLoading(false)
      setOfficialDisabled(false)
      return
    }
    const timer = window.setTimeout(async () => {
      setMarketLoading(true)
      try {
        const items = await searchMarketSkills(accessToken, query, true)
        setMarketSkills(items)
        setOfficialDisabled(false)
        if (query.trim()) {
          setRawError('')
        }
      } catch (err) {
        const apiErr = isApiError(err) ? err : null
        if (apiErr?.status === 503 || apiErr?.code === 'skills.market.not_configured') {
          setOfficialDisabled(true)
          setMarketSkills([])
          setRawError(skillText.officialUnconfigured)
        } else {
          setMarketSkills([])
          setRawError(apiErr?.message || skillText.officialSearchFailed)
        }
      } finally {
        setMarketLoading(false)
      }
    }, query.trim() ? 160 : 0)
    return () => window.clearTimeout(timer)
  }, [accessToken, viewMode, query, skillText.officialSearchFailed, skillText.officialUnconfigured])

  useEffect(() => {
    setError('')
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'builtin') return
    setBuiltinLoading(true)
    Promise.resolve().then(() => { setBuiltinLoading(false) })
  }, [viewMode, refreshBuiltin])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (addMenuRef.current && !addMenuRef.current.contains(target)) {
        setShowAddMenu(false)
      }
      if (cardMenuRef.current && !cardMenuRef.current.contains(target)) {
        setMenuSkillId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const items = useMemo(() => {
    if (viewMode === 'builtin') return []
    return mergeSkills(installedSkills, defaultSkills, marketSkills, query, viewMode)
  }, [viewMode, defaultSkills, installedSkills, marketSkills, query])

  const syncDefaultSkills = useCallback(async (updater: (current: SkillReference[]) => SkillReference[], action: SkillAction) => {
    if (!isCurrentAction(action)) throw new Error('skill_action_stale')
    const current = currentDefaults.current.map(asSkillRef)
    const next = dedupeSkillRefs(updater(current))
    defaultRevision.current += 1
    const updated = await replaceDefaultSkills(accessToken, next)
    if (isCurrentAction(action)) setDefaultSkills(updated)
    return updated
  }, [accessToken, isCurrentAction])

  const shouldConfirmRisk = useCallback((skill: { display_name: string; scan_status?: SkillPackageResponse['scan_status']; scan_summary?: string; scan_has_warnings?: boolean }) => {
    const status = skill.scan_status ?? (skill.scan_has_warnings ? 'suspicious' : 'unknown')
    if (status !== 'suspicious' && status !== 'malicious') return true
    return window.confirm(skillText.riskConfirm(skill.display_name, skillText.scanStatusLabel(status), skill.scan_summary))
  }, [skillText])

  const ensureInstalledAndDefault = useCallback(async (skill: SkillPackageResponse, action: SkillAction) => {
    if (!isCurrentAction(action)) return
    const exists = installedSkills.some((item) => item.skill_key === skill.skill_key && item.version === skill.version)
    if (!exists) {
      const result = await installSkill(accessToken, asSkillRef(skill))
      if (!isCurrentAction(action)) return
      if (!result.success) throw new Error('skill_install_failed')
    }
    await syncDefaultSkills((current) => [...current, asSkillRef(skill)], action)
    if (!isCurrentAction(action)) return
    await refreshInstalled()
  }, [accessToken, installedSkills, isCurrentAction, refreshInstalled, syncDefaultSkills])

  const handleEnable = useCallback(async (item: ViewSkill) => {
    const action = beginAction()
    if (!action) return
    setBusySkillId(item.id)
    setError('')
    try {
      if (item.is_platform && item.version) {
        await setPlatformSkillOverride(accessToken, item.skill_key, item.version, 'auto')
        if (!isCurrentAction(action)) return
        await Promise.all([refreshInstalled(), refreshBuiltin()])
        return
      }
      if (item.installed && item.version) {
        const version = item.version
        if (!shouldConfirmRisk(item)) return
        await syncDefaultSkills((current) => [...current, { skill_key: item.skill_key, version }], action)
        if (!isCurrentAction(action)) return
        await refreshInstalled()
        return
      }
      const imported = await importRegistrySkill(accessToken, {
        slug: item.registry_slug ?? item.skill_key,
        version: item.version,
        skill_key: item.skill_key,
        detail_url: item.detail_url,
        repository_url: item.repository_url,
      })
      if (!isCurrentAction(action) || !shouldConfirmRisk(imported)) return
      await ensureInstalledAndDefault(imported, action)
    } catch (err) {
      if (!isCurrentAction(action)) return
      const apiErr = isApiError(err) ? err : null
      if (apiErr?.code === 'skills.market.repository_missing') setActionError('repositoryMissing')
      else if (apiErr?.message) setError(apiErr.message)
      else setActionError('importFailed')
    } finally {
      if (finishAction(action)) setBusySkillId(null)
    }
  }, [accessToken, beginAction, ensureInstalledAndDefault, finishAction, isCurrentAction, refreshBuiltin, refreshInstalled, setActionError, setError, shouldConfirmRisk, syncDefaultSkills])

  const handleRemove = useCallback(async (item: ViewSkill) => {
    if (!item.version) return
    const action = beginAction()
    if (!action) return
    setBusySkillId(item.id)
    setError('')
    try {
      if (item.is_platform) {
        await setPlatformSkillOverride(accessToken, item.skill_key, item.version, 'removed')
        if (!isCurrentAction(action)) return
        await Promise.all([refreshInstalled(), refreshBuiltin()])
        return
      }
      await syncDefaultSkills((current) => current.filter((skill) => !(skill.skill_key === item.skill_key && skill.version === item.version)), action)
      if (!isCurrentAction(action)) return
      await deleteSkill(accessToken, { skill_key: item.skill_key, version: item.version })
      if (!isCurrentAction(action)) return
      await refreshInstalled()
    } catch (err) {
      if (!isCurrentAction(action)) return
      const apiErr = isApiError(err) ? err : null
      setActionError(apiErr?.code === 'skills.in_use' ? 'deleteConflict' : 'importFailed')
    } finally {
      if (finishAction(action)) setBusySkillId(null)
    }
  }, [accessToken, beginAction, finishAction, isCurrentAction, refreshBuiltin, refreshInstalled, setActionError, setError, syncDefaultSkills])

  const handleDisable = useCallback(async (item: ViewSkill) => {
    if (!item.version) return
    const action = beginAction()
    if (!action) return
    setBusySkillId(item.id)
    setError('')
    try {
      if (item.is_platform) {
        await setPlatformSkillOverride(accessToken, item.skill_key, item.version, 'manual')
        if (!isCurrentAction(action)) return
        await Promise.all([refreshInstalled(), refreshBuiltin()])
        return
      }
      await syncDefaultSkills((current) => current.filter((skill) => !(skill.skill_key === item.skill_key && skill.version === item.version)), action)
      if (!isCurrentAction(action)) return
      await refreshInstalled()
    } catch {
      if (isCurrentAction(action)) setActionError('disableFailed')
    } finally {
      if (finishAction(action)) setBusySkillId(null)
    }
  }, [accessToken, beginAction, finishAction, isCurrentAction, refreshBuiltin, refreshInstalled, setActionError, setError, syncDefaultSkills])

  const handleGitHubImport = useCallback(async (candidatePath?: string) => {
    const action = beginAction()
    if (!action) return
    setImporting(true)
    setError('')
    try {
      const response = await importSkillFromGitHub(accessToken, {
        repository_url: githubUrl.trim(),
        ref: githubRef.trim() || undefined,
        candidate_path: candidatePath,
      })
      if (!isCurrentAction(action)) return
      setCandidateState(null)
      setGitHubOpen(false)
      await ensureInstalledAndDefault(response.skill, action)
      if (!isCurrentAction(action)) return
      setGitHubUrl('')
      setGitHubRef('')
    } catch (err) {
      if (!isCurrentAction(action)) return
      const apiErr = isApiError(err) ? err : null
      const details = apiErr?.details
      if (apiErr?.code === 'skills.import_ambiguous' && details && typeof details === 'object' && Array.isArray((details as { candidates?: unknown[] }).candidates)) {
        setCandidateState({ candidates: (details as { candidates: SkillImportCandidate[] }).candidates })
        return
      }
      if (apiErr?.code === 'skills.import_invalid_repository') setActionError('githubInvalidUrl')
      else if (apiErr?.code === 'skills.import_not_found') setActionError('githubSkillNotFound')
      else if (apiErr?.message) setError(apiErr.message)
      else setActionError('importFailed')
    } finally {
      if (finishAction(action)) setImporting(false)
    }
  }, [accessToken, beginAction, ensureInstalledAndDefault, finishAction, githubRef, githubUrl, isCurrentAction, setActionError, setError])

  const handleUploadImport = useCallback(async () => {
    if (!file) return
    const action = beginAction()
    if (!action) return
    setUploading(true)
    setError('')
    try {
      const response = await importSkillFromUpload(accessToken, { file, install_after_import: false })
      if (!isCurrentAction(action)) return
      if (installAfterImport) await ensureInstalledAndDefault(response, action)
      else await refreshInstalled()
      if (!isCurrentAction(action)) return
      setFile(null)
      setUploadOpen(false)
    } catch {
      if (isCurrentAction(action)) setActionError('importFailed')
    } finally {
      if (finishAction(action)) setUploading(false)
    }
  }, [accessToken, beginAction, ensureInstalledAndDefault, file, finishAction, installAfterImport, isCurrentAction, refreshInstalled, setActionError, setError])

  const active = (item: ViewSkill) => item.installed && item.enabled_by_default

  const platformAvailabilityLabel = (status?: ViewSkill['platform_status']) => {
    if (status === 'auto') return skillText.enabledByDefault
    if (status === 'manual') return skillText.manualAvailable
    return ''
  }

  const platformAvailabilityStyle = (status?: ViewSkill['platform_status']): React.CSSProperties | null => {
    if (status === 'auto') {
      return { background: 'var(--c-status-ok-bg)', color: 'var(--c-status-ok-text)' }
    }
    if (status === 'manual') {
      return { background: 'var(--c-bg-deep)', color: 'var(--c-text-secondary)' }
    }
    return null
  }

  const scanStatusBadge = useCallback((item: ViewSkill) => {
    const status = item.scan_status ?? (item.scan_has_warnings ? 'suspicious' : 'unknown')
    if (status === 'unknown' && !item.scan_summary && !item.scan_has_warnings) return null
    if (status === 'clean') {
      return {
        label: skillText.scanStatusLabel(status),
        style: { background: 'var(--c-status-ok-bg)', color: 'var(--c-status-ok-text)' },
      }
    }
    if (status === 'suspicious') {
      return {
        label: skillText.scanStatusLabel(status),
        style: { background: 'var(--c-status-danger-bg)', color: 'var(--c-status-warning-text)' },
      }
    }
    if (status === 'malicious') {
      return {
        label: skillText.scanStatusLabel(status),
        style: { background: 'var(--c-status-danger-bg)', color: 'var(--c-status-danger-text)' },
      }
    }
    return {
      label: skillText.scanStatusLabel(status),
      style: { background: 'var(--c-bg-deep)', color: 'var(--c-text-tertiary)' },
    }
  }, [skillText])

  type SkillTab = ViewMode
  const tabItems: { key: SkillTab; label: string }[] = [
    { key: 'installed', label: skillText.installedTab },
    { key: 'marketplace', label: skillText.marketplaceTab },
    { key: 'builtin', label: skillText.builtinTab },
  ]

  const sharedViewProps = {
    busySkillId,
    menuSkillId,
    setMenuSkillId,
    onDetailSkill: setDetailSkill,
    onEnable: (item: ViewSkill) => void handleEnable(item),
    onDisable: (item: ViewSkill) => void handleDisable(item),
    onRemove: (item: ViewSkill) => void handleRemove(item),
    onTrySkill,
    skillText,
    locale,
    platformAvailabilityLabel,
    platformAvailabilityStyle,
    scanStatusBadge,
    active,
    cardMenuRef,
  }

  return (
    <div className="flex flex-col gap-4">
      {listFacts.failed && <p role="alert">{t.skillsReadonlyListFailed}</p>}
      {statFacts.failed && <p role="alert">{t.skillsReadonlyStatsFailed}</p>}
      <button type="button" onClick={() => { listFacts.refresh(); statFacts.refresh(); }}>{t.skillsReadonlyRetry}</button>
      {/* TabBar + 搜索 + 添加 */}
      <div className="flex flex-wrap items-center gap-2">
        <DirectionAwareTabs<SkillTab>
          tabs={tabItems.map(tab => ({ id: tab.key, label: tab.label }))}
          activeId={viewMode}
          layoutId="skills-settings-view-tabs"
          onChange={(tab) => { setViewMode(tab); setQuery('') }}
        />
        <div className="flex-1" />
        <div className="relative min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)]" />
          <input aria-label={viewMode === 'marketplace' ? skillText.searchPlaceholderMarketplace : skillText.searchPlaceholder}
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={viewMode === 'marketplace' ? skillText.searchPlaceholderMarketplace : skillText.searchPlaceholder}
            className="h-9 w-full rounded-lg pl-9 pr-3 text-sm text-[var(--c-text-heading)] outline-none placeholder:text-[var(--c-text-tertiary)]"
            style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-page)' }}
          />
          {viewMode === 'marketplace' && marketLoading && (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--c-text-tertiary)]" />
          )}
        </div>

        <div className="relative" ref={addMenuRef}>
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            className={primaryButtonSmCls}
            style={{ background: 'var(--c-btn-bg)', color: 'var(--c-btn-text)' }}
          >
            <PackagePlus size={14} />
            {skillText.add}
            <ChevronDown size={13} />
          </button>
          {showAddMenu && (
            <div
              className="dropdown-menu absolute right-0 top-[calc(100%+4px)] z-50"
              style={{
                border: '0.5px solid var(--c-border-subtle)',
                borderRadius: '10px',
                padding: '4px',
                background: 'var(--c-bg-menu)',
                minWidth: '200px',
                boxShadow: 'var(--c-dropdown-shadow)',
              }}
            >
              <DropdownAction icon={<Upload size={14} />} label={skillText.addFromUpload} onClick={() => { setShowAddMenu(false); setUploadOpen(true) }} />
              <DropdownAction icon={<Github size={14} />} label={skillText.addFromGitHub} onClick={() => { setShowAddMenu(false); setGitHubOpen(true) }} />
            </div>
          )}
        </div>
      </div>

      {viewMode === 'marketplace' && officialDisabled && (
        <p className="text-xs text-[var(--c-text-tertiary)]">{skillText.officialUnconfigured}</p>
      )}
      {visibleError && (
        <p className="text-xs" style={{ color: 'var(--c-status-error-text)' }}>{visibleError}</p>
      )}

      {viewMode === 'installed' && (
        <InstalledSkillsView
          {...sharedViewProps}
          items={items}
          loading={loading}
          accessToken={accessToken}
          statsMap={statsMap}
          catalogReady={listFacts.data !== null}
          statsReady={statFacts.data !== null}
          statsUnavailable={statFacts.failed}
          statsUnknownLabel={t.skillsReadonlyUnknown}
          statsMetricUnknownLabel={t.skillsReadonlyMetricUnknown}
        />
      )}

      {viewMode === 'marketplace' && (
        <MarketplaceView
          {...sharedViewProps}
          items={items}
          loading={loading}
          marketLoading={marketLoading}
        />
      )}

      {viewMode === 'builtin' && (
        <BuiltinSkillsView
          builtinSkills={builtinSkills}
          builtinLoading={builtinLoading}
          busySkillId={busySkillId}
          setBusySkillId={setBusySkillId}
          setError={setError}
          query={query}
          accessToken={accessToken}
          skillText={skillText}
          refreshInstalled={refreshInstalled}
          setBuiltinSkills={setBuiltinSkills}
          refreshBuiltin={refreshBuiltin}
          platformAvailabilityLabel={platformAvailabilityLabel}
          platformAvailabilityStyle={platformAvailabilityStyle}
        />
      )}

      {/* 上传对话框 */}
      <Modal
        open={uploadOpen}
        onClose={() => { if (!uploading) setUploadOpen(false) }}
        title={skillText.uploadTitle}
        width="440px"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--c-text-heading)]">{skillText.uploadFileLabel}</span>
            <label
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-[var(--c-bg-deep)]"
              style={{ border: '0.5px dashed var(--c-border-mid)', background: 'var(--c-bg-page)' }}
            >
              <Upload size={14} className="shrink-0 text-[var(--c-text-tertiary)]" />
              <span className={file ? 'text-[var(--c-text-heading)]' : 'text-[var(--c-text-tertiary)]'}>
                {file?.name ?? skillText.uploadFileHint}
              </span>
              <input
                type="file"
                accept=".zip,.skill,application/zip,application/octet-stream"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--c-text-secondary)]">
            <input
              type="checkbox"
              checked={installAfterImport}
              onChange={(e) => setInstallAfterImport(e.target.checked)}
              className="size-3.5 rounded"
              style={{ accentColor: 'var(--c-text-heading)' }}
            />
            {skillText.uploadImmediateInstall}
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              className={secondaryButtonSmCls}
              style={secondaryButtonBorderStyle}
            >
              {skillText.cancelAction}
            </button>
            <button
              type="button"
              onClick={() => void handleUploadImport()}
              disabled={!file || uploading}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--c-btn-bg)', color: 'var(--c-btn-text)' }}
            >
              {uploading && <Loader2 size={14} className="animate-spin" />}
              {uploading ? skillText.uploading : skillText.uploadAction}
            </button>
          </div>
        </div>
      </Modal>

      {/* GitHub 导入对话框 */}
      <Modal
        open={githubOpen}
        onClose={() => { if (!importing) setGitHubOpen(false) }}
        title={skillText.githubTitle}
        width="440px"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--c-text-heading)]">{skillText.githubUrlLabel}</span>
            <input aria-label={skillText.githubUrlPlaceholder}
              value={githubUrl}
              onChange={(e) => setGitHubUrl(e.target.value)}
              placeholder={skillText.githubUrlPlaceholder}
              className="h-9 w-full rounded-lg px-3 text-sm text-[var(--c-text-heading)] outline-none placeholder:text-[var(--c-text-tertiary)]"
              style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-page)' }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--c-text-heading)]">{skillText.githubRefLabel}</span>
            <input aria-label="main"
              value={githubRef}
              onChange={(e) => setGitHubRef(e.target.value)}
              placeholder="main"
              className="h-9 w-full rounded-lg px-3 text-sm text-[var(--c-text-heading)] outline-none placeholder:text-[var(--c-text-tertiary)]"
              style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-page)' }}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setGitHubOpen(false)}
              className={secondaryButtonSmCls}
              style={secondaryButtonBorderStyle}
            >
              {skillText.cancelAction}
            </button>
            <button
              type="button"
              onClick={() => void handleGitHubImport()}
              disabled={!githubUrl.trim() || importing}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--c-btn-bg)', color: 'var(--c-btn-text)' }}
            >
              {importing && <Loader2 size={14} className="animate-spin" />}
              {importing ? skillText.importing : skillText.githubAction}
            </button>
          </div>
        </div>
      </Modal>

      {/* 候选目录选择对话框 */}
      <Modal
        open={!!candidateState}
        onClose={() => setCandidateState(null)}
        title={skillText.candidatesTitle}
        width="440px"
      >
        {candidateState && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--c-text-tertiary)]">{skillText.chooseCandidate}</p>
            {candidateState.candidates.map((candidate) => (
              <button
                key={candidate.path}
                type="button"
                onClick={() => void handleGitHubImport(candidate.path)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors duration-100 bg-[var(--c-bg-page)] hover:bg-[var(--c-bg-deep)]"
                style={{ border: '0.5px solid var(--c-border-subtle)' }}
              >
                <div>
                  <span className="block text-sm font-medium text-[var(--c-text-heading)]">
                    {candidate.display_name ?? candidate.skill_key ?? candidate.path}
                  </span>
                  <span className="block text-xs text-[var(--c-text-tertiary)]">{candidate.path}</span>
                </div>
                <ChevronRight size={13} className="shrink-0 text-[var(--c-text-tertiary)]" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {detailSkill && (
        <SkillDetailModal
          item={detailSkill}
          onClose={() => setDetailSkill(null)}
          onEnable={(item) => void handleEnable(item)}
          onDisable={(item) => void handleDisable(item)}
          onRemove={(item) => void handleRemove(item)}
          onTrySkill={onTrySkill}
          skillText={skillText}
          locale={locale}
          active={active}
          platformAvailabilityLabel={platformAvailabilityLabel}
          platformAvailabilityStyle={platformAvailabilityStyle}
          scanStatusBadge={scanStatusBadge}
          metricUnknownLabel={t.skillsReadonlyMetricUnknown}
          stats={detailSkill.skill_key ? statsMap.get(detailSkill.skill_key) : undefined}
        />
      )}
    </div>
  )
}
