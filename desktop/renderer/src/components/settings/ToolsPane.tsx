import type { PluginMcpServerDto } from '../../../../shared/plugin-catalog-ipc-contract';
import { connectorsErrorMessage } from '../../lib/connectors-error';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SlidersHorizontal,
  Loader2,
  Wrench,
  Search,
  Link as LinkIcon,
  Monitor,
} from 'lucide-react';
import { api } from '../../api';
import type { ConnectorsConfig, ConnectorsConfigSnapshot, ConnectorsProviderRuntime } from '../../api/types';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, btnPrimary, btnSecondary } from './settings-ui';
import type { PluginDependencyStatus } from './mcp-plugin-dependency-display';
import { SEARCH_PROVIDERS, FETCH_PROVIDERS, RuntimeBadge, providerSummary } from './tools-provider-display';
import { ApiKeyInput } from './ApiKeyInput';
import { TestButton } from './TestButton';

// CUA driver 的受管安装路径，严格全路径匹配（评审 P2：子串/后缀匹配过宽）：
// - macOS 官方安装脚本的三个固定候选（desktop-services.ts binaryCandidates，~ 展开为 /Users/<user>）；
// - Windows 私有发布目录 <dataRoot>\runtime\cua-driver\<version>\cua-driver.exe（cua-release-install.ts）。
// 其余路径（含环境变量覆盖）视为自定义：只提示、不提供应用内更新。
function isManagedCuaDriverPath(binary: string | undefined): boolean {
  if (!binary) return false;
  const normalized = binary.replace(/\\/g, '/').toLowerCase();
  if (normalized === '/usr/local/bin/cua-driver' || normalized === '/opt/homebrew/bin/cua-driver') return true;
  if (/^\/users\/[^/]+\/\.local\/bin\/cua-driver$/.test(normalized)) return true;
  if (/^[a-z]:\/.+\/runtime\/cua-driver\/[^/]+\/cua-driver\.exe$/.test(normalized)) return true;
  return false;
}

export function ToolsPane() {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const labelsRef = useRef(ds);
  labelsRef.current = ds;
  const readGeneration = useRef(0);
  const [readError, setReadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<ConnectorsConfigSnapshot | null>(null);
  const [testConfigConfirmed, setTestConfigConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<ConnectorsConfig | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedFetchOpen, setAdvancedFetchOpen] = useState(false);

  // 电脑操作区：复用插件依赖安装/更新 IPC，与 MCP 页共享 main 侧任务状态。
  const [cuaDependency, setCuaDependency] = useState<PluginDependencyStatus | null>(null);
  const [cuaServer, setCuaServer] = useState<PluginMcpServerDto | null>(null);
  const [cuaUnavailable, setCuaUnavailable] = useState(false);
  const [cuaPending, setCuaPending] = useState('');
  // 取消用独立锁：install/update IPC 等待完整任务结果（非启动回执），
  // 本入口发起的任务期间 cuaPending 一直被持有，取消不能被它阻塞。
  const [cuaCancelling, setCuaCancelling] = useState(false);
  const cuaGeneration = useRef(0);
  const cuaMounted = useRef(true);

  // Singleflight（台账 #28）：忙时定时 tick 跳过，手动刷新最多排队一次；
  // 慢读取（main 健康检查可达 30s）不会被后续 tick 持续作废。
  const cuaPendingRead = useRef<number | null>(null);
  const cuaManualReread = useRef(false);
  const loadCua = useCallback((queueIfBusy = true) => {
    if (cuaPendingRead.current !== null) { if (queueIfBusy) cuaManualReread.current = true; return; }
    const generation = ++cuaGeneration.current;
    cuaPendingRead.current = generation;
    void (async () => {
      try {
        const [dependencies, servers] = await Promise.allSettled([
          api.listPluginDependencyStatuses(),
          api.listPluginMcpServers(),
        ]);
        if (generation !== cuaGeneration.current || !cuaMounted.current) return;
        if (dependencies.status === 'fulfilled' && servers.status === 'fulfilled') {
          setCuaDependency(dependencies.value.find(d => d.pluginName === 'cua-computer-use' && d.dependencyId === 'cua-driver') ?? null);
          setCuaServer(servers.value.find(s => s.pluginName === 'cua-computer-use' && s.name === 'cua-driver') ?? null);
          setCuaUnavailable(false);
        } else {
          setCuaUnavailable(true);
        }
      } catch {
        // preload API 缺失等异常按不可用降级，不影响设置页其余部分。
        if (generation === cuaGeneration.current && cuaMounted.current) setCuaUnavailable(true);
      } finally {
        if (cuaPendingRead.current === generation) {
          cuaPendingRead.current = null;
          if (cuaManualReread.current) { cuaManualReread.current = false; loadCua(); }
        }
      }
    })();
  }, []);

  useEffect(() => {
    cuaMounted.current = true;
    loadCua();
    const timer = setInterval(() => loadCua(false), 2_000);
    return () => {
      cuaMounted.current = false; clearInterval(timer);
      cuaGeneration.current += 1; cuaPendingRead.current = null; cuaManualReread.current = false;
    };
  }, [loadCua]);

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    setRefreshing(true);
    try {
      const snap = await api.getConnectorsConfig();
      if (generation !== readGeneration.current) return;
      if (!snap) throw Error('connectors_projection_unavailable');
      setSnapshot(snap);
      setTestConfigConfirmed(true);
      setDraft(current => current ?? snap.config);
      setReadError('');
    } catch (failure) {
      if (generation === readGeneration.current) setReadError(connectorsErrorMessage(failure, labelsRef.current, true));
    } finally {
      if (generation === readGeneration.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  useEffect(() => { void load(); return () => { readGeneration.current++; }; }, [load]);

  const runtimeOf = useCallback((name: string): ConnectorsProviderRuntime | undefined => {
    return snapshot?.providers.find(p => p.provider_name === name);
  }, [snapshot]);

  const handleSave = async () => {
    if (!draft) return;
    const submitted = draft;
    // Reads begun before this mutation cannot confirm its eventual outcome.
    readGeneration.current++;
    setRefreshing(false);
    setSaving(true);
    setTestConfigConfirmed(false);
    setError('');
    setSuccess('');
    try {
      const next = await api.saveConnectorsConfig(submitted);
      if (next) {
        // Acknowledged save supersedes reads begun before this commit.
        readGeneration.current++;
        setRefreshing(false);
        setReadError('');
        setSnapshot(next);
        setTestConfigConfirmed(true);
        if (draftRef.current === submitted) {
          setDraft(next.config);
          setSuccess(t.desktopSettings.connectorSaved);
        }
      } else {
        setError(t.desktopSettings.connectorSaveFailedNoDesktop);
      }
    } catch (e) {
      setError(connectorsErrorMessage(e, ds));
    } finally {
      setSaving(false);
    }
  };

  const handleCuaInstall = async () => {
    const dependency = cuaDependency;
    if (!dependency || cuaPending || dependency.task || !dependency.canInstall) return;
    if (!window.confirm(ds.mcpInstallConfirm(dependency.displayName))) return;
    setCuaPending('install');
    try {
      const result = await api.installPluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!cuaMounted.current) return;
      if (!result.success) window.alert(ds.mcpInstallFailed);
      void loadCua();
    } catch { if (cuaMounted.current) window.alert(ds.mcpInstallFailed); }
    finally { if (cuaMounted.current) setCuaPending(''); }
  };

  const handleCuaSetup = async () => {
    const dependency = cuaDependency;
    if (!dependency || cuaPending || dependency.task || !dependency.canInstall) return;
    if (!window.confirm(ds.mcpSetupConfirm(ds.computerUseTitle, dependency.displayName))) return;
    setCuaPending('setup');
    try {
      const pluginResult = await api.installPlugin(dependency.pluginName);
      if (!cuaMounted.current) return;
      if (!pluginResult.success) { window.alert(ds.mcpPluginInstallFailed); return; }
      const result = await api.installPluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!cuaMounted.current) return;
      if (!result.success) window.alert(ds.mcpInstallFailed);
      void loadCua();
    } catch { if (cuaMounted.current) window.alert(ds.mcpInstallFailed); }
    finally { if (cuaMounted.current) setCuaPending(''); }
  };

  const handleCuaUpdate = async () => {
    const dependency = cuaDependency;
    if (!dependency || cuaPending || dependency.task || !dependency.canUpdate) return;
    if (!window.confirm(ds.mcpUpdateConfirm(dependency.displayName))) return;
    setCuaPending('update');
    try {
      const result = await api.updatePluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!cuaMounted.current) return;
      if (!result.success) {
        window.alert(result.error === 'external_driver_update_not_allowed'
          ? ds.computerUseExternalUpdateBlocked
          : ds.mcpUpdateFailed);
      }
      void loadCua();
    } catch { if (cuaMounted.current) window.alert(ds.mcpUpdateFailed); }
    finally { if (cuaMounted.current) setCuaPending(''); }
  };

  const handleCuaEnable = async () => {
    if (cuaPending) return;
    setCuaPending('enable');
    try {
      await api.enableComputerUse();
      if (cuaMounted.current) void loadCua();
    } catch (e) { if (cuaMounted.current) window.alert((e as Error).message); }
    finally { if (cuaMounted.current) setCuaPending(''); }
  };

  const handleCuaCancel = async () => {
    const dependency = cuaDependency;
    if (!dependency || cuaCancelling) return;
    setCuaCancelling(true);
    try {
      await api.cancelPluginDependencyTask({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId });
      if (cuaMounted.current) loadCua();
    } catch { if (cuaMounted.current) window.alert(t.mcpMutationFailed); }
    finally { if (cuaMounted.current) setCuaCancelling(false); }
  };

  const handleCuaPermission = async (permission: 'accessibility' | 'screen') => {
    if (cuaPending) return;
    setCuaPending('permission:' + permission);
    try { await api.openPluginDependencyPermissionSettings({ permission }); }
    catch { if (cuaMounted.current) window.alert(t.mcpMutationFailed); }
    finally { if (cuaMounted.current) setCuaPending(''); }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="text-sm text-[var(--c-text-secondary)]">
        {readError || t.desktopSettings.connectorLoadFailed}
        <button type="button" className={btnSecondary} disabled={refreshing} onClick={() => { void load(); }}>{ds.connectorRefreshData}</button>
      </div>
    );
  }

  const search = draft.search;
  const fetchCfg = draft.fetch;
  const configConfirmed = JSON.stringify(draft) === JSON.stringify(snapshot?.config);
  const canTest = testConfigConfirmed && !saving && !refreshing && configConfirmed;
  // 零配置默认视图：无变更且未展开高级设置时不显示保存区。
  const showSaveSection = !configConfirmed || advancedSearchOpen || advancedFetchOpen;

  const cuaPluginInstalled = cuaDependency
    ? (cuaDependency.pluginInstalled ?? cuaServer?.pluginName === cuaDependency.pluginName)
    : false;
  const cuaCustomPath = Boolean(cuaDependency
    && (cuaDependency.state === 'ready' || cuaDependency.state === 'degraded')
    && cuaDependency.resolvedBinary && !isManagedCuaDriverPath(cuaDependency.resolvedBinary));
  const cuaStatusText = (() => {
    if (!cuaDependency) return '';
    switch (cuaDependency.state) {
      case 'unsupported': return ds.computerUseUnsupported;
      case 'missing': return ds.computerUseDriverMissing(cuaDependency.displayName);
      case 'ready': return cuaDependency.version ? `${ds.mcpDepAvailable} · v${cuaDependency.version}` : ds.mcpDepAvailable;
      case 'degraded': return cuaDependency.code === 'version_too_old' ? ds.mcpDepNeedsUpdate : (cuaDependency.detail || ds.mcpDepNeedsAttention);
      case 'needs_permission':
        return cuaDependency.code === 'permission_accessibility_missing' ? ds.mcpDepNeedsAccessibility
          : cuaDependency.code === 'permission_screen_missing' ? ds.mcpDepNeedsScreenRecording
          : (cuaDependency.detail || ds.mcpDepNeedsAttention);
      default: return cuaDependency.detail || ds.mcpDepNeedsAttention;
    }
  })();

  return (
    <>
      <Section key="connectors-overview">
        <SectionHeader icon={Wrench}>{t.desktopSettings.networkTools}</SectionHeader>
        <div className="text-xs text-[var(--c-text-secondary)] mb-3">
          {t.desktopSettings.networkToolsDesc}
        </div>
        <div aria-live="polite">{readError && <div className="text-xs text-red-500">{readError}</div>}</div>
        <button type="button" className={btnSecondary} disabled={refreshing} onClick={() => { void load(); }}>{ds.connectorRefreshData}</button>
        {snapshot?.loadStatus === 'parse_failed' && (
          <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            {t.desktopSettings.connectorConfigParseError}
          </div>
        )}
      </Section>

      <Section key="connectors-search">
        <SectionHeader icon={Search}>{t.desktopSettings.searchProviderTitle}</SectionHeader>
        {snapshot && (() => {
          const summary = providerSummary('search', snapshot.config, ds);
          return (
            <div aria-label="summary-search" className="mb-3 flex items-center gap-2 flex-wrap rounded-lg border border-[var(--c-border-subtle)] px-3 py-2">
              <span className="text-sm font-medium">{summary.label}</span>
              <span className="text-xs text-[var(--c-text-secondary)]">{summary.note}</span>
            </div>
          );
        })()}
        <button
          type="button"
          aria-label="advanced-search"
          aria-expanded={advancedSearchOpen}
          onClick={() => setAdvancedSearchOpen(v => !v)}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] transition-colors"
        >
          <SlidersHorizontal size={12} />
          {ds.toolsAdvancedToggle}
        </button>
        {advancedSearchOpen && (<>
        <div className="flex flex-col gap-3">
          {SEARCH_PROVIDERS.map(opt => {
            const checked = search.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(`web_search.${opt.key}`);
            return (
              <Card key={opt.key} className={disabled ? 'opacity-60' : ''}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="search-provider"
                    value={opt.key}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setDraft(d => d ? { ...d, search: { ...d.search, provider: opt.key } } : d)}
                    className="mt-1"
                    aria-label={`search-${opt.key}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{opt.label}</span>
                      <RuntimeBadge runtime={runtime} ds={t.desktopSettings} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings[opt.descKey]}</div>
                    {checked && opt.key === 'tavily' && (
                      <ApiKeyInput
                        ariaLabel="tavily-api-key"
                        placeholder={t.desktopSettings.tavilyApiKeyPlaceholder}
                        storedValue={search.tavilyApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, tavilyApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'brave' && (
                      <ApiKeyInput
                        ariaLabel="brave-api-key"
                        placeholder={t.desktopSettings.braveApiKeyPlaceholder}
                        storedValue={search.braveApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, braveApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'firecrawl' && (
                      <ApiKeyInput
                        ariaLabel="firecrawl-search-api-key"
                        placeholder={t.desktopSettings.firecrawlApiKeyPlaceholder}
                        storedValue={search.firecrawlApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, firecrawlApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'deepseek' && (
                      <div className="mt-2 text-xs text-[var(--c-text-secondary)]">
                        {t.desktopSettings.deepseekKeyFromModelConfigHint}
                      </div>
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="search" config={draft} savedConfig={snapshot?.config} canTest={canTest} ds={t.desktopSettings} />
        </>)}
      </Section>

      <Section key="connectors-fetch">
        <SectionHeader icon={LinkIcon}>{t.desktopSettings.fetchProviderTitle}</SectionHeader>
        {snapshot && (() => {
          const summary = providerSummary('fetch', snapshot.config, ds);
          return (
            <div aria-label="summary-fetch" className="mb-3 flex items-center gap-2 flex-wrap rounded-lg border border-[var(--c-border-subtle)] px-3 py-2">
              <span className="text-sm font-medium">{summary.label}</span>
              <span className="text-xs text-[var(--c-text-secondary)]">{summary.note}</span>
            </div>
          );
        })()}
        <button
          type="button"
          aria-label="advanced-fetch"
          aria-expanded={advancedFetchOpen}
          onClick={() => setAdvancedFetchOpen(v => !v)}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] transition-colors"
        >
          <SlidersHorizontal size={12} />
          {ds.toolsAdvancedToggle}
        </button>
        {advancedFetchOpen && (<>
        <div className="flex flex-col gap-3">
          {FETCH_PROVIDERS.map(opt => {
            const checked = fetchCfg.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(`web_fetch.${opt.key}`);
            return (
              <Card key={opt.key} className={disabled ? 'opacity-60' : ''}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="fetch-provider"
                    value={opt.key}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setDraft(d => d ? { ...d, fetch: { ...d.fetch, provider: opt.key } } : d)}
                    className="mt-1"
                    aria-label={`fetch-${opt.key}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{opt.label}</span>
                      {opt.key === 'jina' && runtime?.runtime_state !== 'ready' ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-50 text-blue-600">{ds.toolsFreeAvailable}</span>
                      ) : (
                        <RuntimeBadge runtime={runtime} ds={t.desktopSettings} />
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings[opt.descKey]}</div>
                    {checked && opt.key === 'jina' && (
                      <ApiKeyInput
                        ariaLabel="jina-api-key"
                        placeholder={t.desktopSettings.jinaApiKeyPlaceholder}
                        storedValue={fetchCfg.jinaApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, fetch: { ...d.fetch, jinaApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'firecrawl' && (
                      <ApiKeyInput
                        ariaLabel="firecrawl-fetch-api-key"
                        placeholder={t.desktopSettings.firecrawlApiKeyPlaceholder}
                        storedValue={fetchCfg.firecrawlApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, fetch: { ...d.fetch, firecrawlApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'deepseek' && (
                      <div className="mt-2 text-xs text-[var(--c-text-secondary)]">
                        {t.desktopSettings.deepseekKeyFromModelConfigHint}
                      </div>
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="fetch" config={draft} savedConfig={snapshot?.config} canTest={canTest} ds={t.desktopSettings} />
        </>)}
      </Section>

      {showSaveSection && (<Section>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{t.desktopSettings.connectorSaving}</span> : t.desktopSettings.connectorSaveBtn}
          </button>
          {success && <span className="text-xs text-green-600">{success}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </Section>)}

      <Section key="computer-use">
        <SectionHeader icon={Monitor}>{ds.computerUseTitle}</SectionHeader>
        <div className="text-xs text-[var(--c-text-secondary)] mb-3">{ds.computerUseDesc}</div>
        {cuaUnavailable || !cuaDependency ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-[var(--c-text-secondary)]">{ds.computerUseUnavailable}</span>
            <button type="button" className={btnSecondary} onClick={() => { void loadCua(); }}>{ds.computerUseRefresh}</button>
          </div>
        ) : (
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{cuaDependency.displayName}</div>
                <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{cuaStatusText}</div>
                {cuaDependency.task && (
                  <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                    {cuaDependency.task.state === 'cancelling' ? ds.mcpCancellingTask : ds.computerUseTaskRunning}
                  </div>
                )}
                {cuaDependency.resolvedBinary && (
                  <div className="mt-1 text-xs text-[var(--c-text-tertiary)] break-all">{cuaDependency.resolvedBinary}</div>
                )}
                {cuaCustomPath && cuaDependency.resolvedBinary && (
                  <div className="mt-1 text-xs text-yellow-600">{ds.computerUseCustomPath(cuaDependency.resolvedBinary)}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 flex-wrap">
                {cuaDependency.task ? (
                  <button type="button" className={btnSecondary}
                    disabled={cuaCancelling || cuaDependency.task.state === 'cancelling'}
                    onClick={() => { void handleCuaCancel(); }}>
                    {cuaDependency.task.state === 'cancelling' ? ds.mcpCancellingTask : ds.mcpCancelTask}
                  </button>
                ) : (
                  <>
                    {cuaDependency.state === 'missing' && cuaDependency.canInstall && (cuaPluginInstalled ? (
                      <button type="button" className={btnPrimary} disabled={cuaPending !== ''} onClick={() => { void handleCuaInstall(); }}>
                        {ds.computerUseInstall}
                      </button>
                    ) : (
                      <button type="button" className={btnPrimary} disabled={cuaPending !== ''} onClick={() => { void handleCuaSetup(); }}>
                        {ds.mcpInstallAndEnable}
                      </button>
                    ))}
                    {(cuaDependency.state === 'ready' || cuaDependency.state === 'degraded') && cuaDependency.canUpdate && !cuaCustomPath && (
                      <button type="button" className={btnSecondary} disabled={cuaPending !== ''} onClick={() => { void handleCuaUpdate(); }}>
                        {ds.mcpUpdate}
                      </button>
                    )}
                    {cuaDependency.state === 'ready' && (!cuaServer || !cuaServer.connected) && (
                      <button type="button" className={btnPrimary} disabled={cuaPending !== ''} onClick={() => { void handleCuaEnable(); }}>
                        {ds.mcpEnableComputerUse}
                      </button>
                    )}
                    {cuaDependency.state === 'needs_permission' && cuaDependency.code === 'permission_accessibility_missing' && (
                      <button type="button" className={btnSecondary} disabled={cuaPending !== ''} onClick={() => { void handleCuaPermission('accessibility'); }}>
                        {ds.mcpOpenAccessibility}
                      </button>
                    )}
                    {cuaDependency.state === 'needs_permission' && cuaDependency.code === 'permission_screen_missing' && (
                      <button type="button" className={btnSecondary} disabled={cuaPending !== ''} onClick={() => { void handleCuaPermission('screen'); }}>
                        {ds.mcpOpenScreenRecording}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </Card>
        )}
      </Section>

    </>
  );
}
