import { MCP_INSTALLS_READONLY_OUTPUT_SCHEMA } from '../../../../shared/channel-mcp-readonly-ipc-contract';
import type { PluginMcpServerDto } from '../../../../shared/plugin-catalog-ipc-contract';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings,
  Loader2,
  Plug,
  Trash2,
  Plus,
  Info,
  Package,
  Wrench,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../api';
import { McpErrorRemediationBanner } from './McpErrorRemediationBanner';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, SettingsRefreshButton, SettingsReadError, Section, Card, inputCls, btnPrimary, btnSecondary } from './settings-ui';
import { formatPluginDependencyTitle, formatPluginDependencyStatus, formatPluginDependencyLayerRows, pluginDependencyBadgeClass } from './mcp-plugin-dependency-display';
import type { PluginDependencyStatus } from './mcp-plugin-dependency-display';

// ---- MCP ----

interface MCPInstallConfig {
  id: string;
  name: string;
  source: string;
  command: string;
  args?: string[];
  enabled: boolean;
  createdAt: number;
}

export function McpPane() {
  const { t, locale } = useLocale();
  const ts = t.desktopSettings;
  const [installs, setInstalls] = useState<MCPInstallConfig[]>([]);
  const [pluginServers, setPluginServers] = useState<PluginMcpServerDto[]>([]);
  const [dependencies, setDependencies] = useState<PluginDependencyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [dependencyAction, setDependencyAction] = useState('');

  const [installsReady, setInstallsReady] = useState(false), [installsUnavailable, setInstallsUnavailable] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  type ActionOwner = { active: boolean; epoch: number; pending: Map<string, symbol> };
  type ActionLease = { owner: ActionOwner; epoch: number; token: symbol; keys: string[] };
  const actionOwner = useRef<ActionOwner>({ active: false, epoch: 0, pending: new Map() });
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const owner = actionOwner.current;
    owner.active = true; owner.epoch += 1;
    setPendingActions(new Set(owner.pending.keys()));
    return () => {
      owner.active = false; owner.epoch += 1;
      // Pending effects remain locked across locale changes until their real settlement.
    };
  }, [locale]);
  const beginAction = (keys: string[]): ActionLease | null => {
    const owner = actionOwner.current;
    if (!owner.active || keys.some(key => owner.pending.has(key))) return null;
    const token = Symbol();
    for (const key of keys) owner.pending.set(key, token);
    setPendingActions(new Set(owner.pending.keys()));
    return { owner, epoch: owner.epoch, token, keys };
  };
  const isCurrentAction = (lease: ActionLease) => actionOwner.current === lease.owner
    && lease.owner.active && lease.owner.epoch === lease.epoch;
  const finishAction = (lease: ActionLease) => {
    for (const key of lease.keys) if (lease.owner.pending.get(key) === lease.token) lease.owner.pending.delete(key);
    // An old locale may release only its own settled locks; it cannot publish an action fact.
    if (actionOwner.current === lease.owner && lease.owner.active) setPendingActions(new Set(lease.owner.pending.keys()));
  };

  const readGeneration = useRef(0), pendingRead = useRef<number | null>(null), manualReread = useRef(false);
  const load = useCallback((queueIfBusy = true) => {
    if (pendingRead.current !== null) { if (queueIfBusy) manualReread.current = true; return; }
    const generation = ++readGeneration.current;
    pendingRead.current = generation;
    Promise.allSettled([
      (async () => { const raw = await api.listMCPInstalls(); const parsed = MCP_INSTALLS_READONLY_OUTPUT_SCHEMA.safeParse(raw); if (!parsed.success) throw Error('channel_mcp_projection_unavailable'); return parsed.data; })(),
      api.listPluginMcpServers(),
      api.listPluginDependencyStatuses(),
    ]).then(([mcpInstalls, plugins, dependencyStatuses]) => {
      if (generation !== readGeneration.current) return;
      if (mcpInstalls.status === 'fulfilled') { setInstalls(mcpInstalls.value); setInstallsReady(true); }
      setInstallsUnavailable(mcpInstalls.status === 'rejected');
      if (plugins.status === 'fulfilled') setPluginServers(plugins.value);
      if (dependencyStatuses.status === 'fulfilled') setDependencies(dependencyStatuses.value);
      setCatalogUnavailable(plugins.status === 'rejected' || dependencyStatuses.status === 'rejected');
    }).finally(() => {
      if (pendingRead.current === generation) {
        pendingRead.current = null; setLoading(false);
        if (manualReread.current) { manualReread.current = false; load(); }
      }
    });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 2_000);
    return () => { clearInterval(timer); readGeneration.current += 1; pendingRead.current = null; manualReread.current = false; };
  }, [load, locale]);

  const handleCreate = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    const lease = beginAction(['create']);
    if (!lease) return;
    try {
      await api.createMCPInstall({
        name: newName.trim(), source: 'npm', command: newCommand.trim(),
        args: newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined,
      });
      if (!isCurrentAction(lease)) return;
      setNewName(''); setNewCommand(''); setNewArgs(''); setShowAdd(false);
      load();
    } catch {
      if (isCurrentAction(lease)) alert(t.mcpMutationFailed);
    } finally { finishAction(lease); }
  };

  const handleDelete = async (id: string) => {
    if (!actionOwner.current.active || actionOwner.current.pending.has('row:' + id)) return;
    if (!window.confirm(t.mcpInstallDeleteConfirm)) return;
    const lease = beginAction(['row:' + id]);
    if (!lease) return;
    try {
      await api.deleteMCPInstall(id);
      if (isCurrentAction(lease)) load();
    } catch {
      if (isCurrentAction(lease)) alert(t.mcpMutationFailed);
    } finally { finishAction(lease); }
  };

  const dependencyKey = (dependency: PluginDependencyStatus) => 'dependency:' + dependency.pluginName + ':' + dependency.dependencyId;
  const handleInstallDependency = async (dependency: PluginDependencyStatus) => {
    const key = dependencyKey(dependency);
    if (!dependency.canInstall || !actionOwner.current.active || actionOwner.current.pending.has(key)) return;
    if (!window.confirm(ts.mcpInstallConfirm(dependency.displayName))) return;
    const lease = beginAction([key]); if (!lease) return;
    try {
      const result = await api.installPluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!isCurrentAction(lease)) return;
      if (!result.success) alert(ts.mcpInstallFailed);
      load();
    } catch { if (isCurrentAction(lease)) alert(ts.mcpInstallFailed); }
    finally { finishAction(lease); }
  };
  const handleSetupPluginDependency = async (dependency: PluginDependencyStatus) => {
    const key = dependencyKey(dependency), pluginKey = 'plugin:' + dependency.pluginName;
    if (!dependency.canInstall || !actionOwner.current.active || actionOwner.current.pending.has(key) || actionOwner.current.pending.has(pluginKey)) return;
    if (!window.confirm(ts.mcpSetupConfirm(formatPluginDependencyTitle(dependency), dependency.displayName))) return;
    const lease = beginAction([key, pluginKey]); if (!lease) return;
    try {
      const pluginResult = await api.installPlugin(dependency.pluginName);
      if (!isCurrentAction(lease)) return;
      if (!pluginResult.success) { alert(ts.mcpPluginInstallFailed); return; }
      const result = await api.installPluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!isCurrentAction(lease)) return;
      if (!result.success) alert(ts.mcpInstallFailed);
      load();
    } catch { if (isCurrentAction(lease)) alert(ts.mcpInstallFailed); }
    finally { finishAction(lease); }
  };
  const handleUpdateDependency = async (dependency: PluginDependencyStatus) => {
    const key = dependencyKey(dependency);
    if (!dependency.canUpdate || !actionOwner.current.active || actionOwner.current.pending.has(key)) return;
    if (!window.confirm(ts.mcpUpdateConfirm(dependency.displayName))) return;
    const lease = beginAction([key]); if (!lease) return;
    try {
      const result = await api.updatePluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId, confirmed: true });
      if (!isCurrentAction(lease)) return;
      if (!result.success) alert(ts.mcpUpdateFailed);
      load();
    } catch { if (isCurrentAction(lease)) alert(ts.mcpUpdateFailed); }
    finally { finishAction(lease); }
  };
  const handleDiagnoseDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canDiagnose) return;
    const lease = beginAction([dependencyKey(dependency)]); if (!lease) return;
    try {
      const result = await api.diagnosePluginDependency({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId });
      if (!isCurrentAction(lease)) return;
      if (!result.success) alert(ts.mcpDiagnoseFailed);
      load();
    } catch { if (isCurrentAction(lease)) alert(ts.mcpDiagnoseFailed); }
    finally { finishAction(lease); }
  };
  const handleCancelDependency = async (dependency: PluginDependencyStatus) => {
    const lease = beginAction(['cancel:' + dependencyKey(dependency)]); if (!lease) return;
    try {
      await api.cancelPluginDependencyTask({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId });
      if (isCurrentAction(lease)) load();
    } catch { if (isCurrentAction(lease)) alert(t.mcpMutationFailed); }
    finally { finishAction(lease); }
  };
  const handleOpenPermissionSettings = async (permission: 'accessibility' | 'screen') => {
    const lease = beginAction(['permission:' + permission]); if (!lease) return;
    try { await api.openPluginDependencyPermissionSettings({ permission }); }
    catch { if (isCurrentAction(lease)) alert(t.mcpMutationFailed); }
    finally { finishAction(lease); }
  };
  // Retry retains original disabled-CUA policy; one component lock, no desired-state write.
  const handleRetryPluginComponent = async (componentId: string) => {
    const lease = beginAction(['retry:' + componentId]); if (!lease) return;
    try { await api.retryPluginComponent({ componentId }); if (isCurrentAction(lease)) load(); }
    catch { if (isCurrentAction(lease)) alert(t.mcpMutationFailed); }
    finally { finishAction(lease); }
  };

  const handleEnableComputerUse = async () => {
    const actionKey = 'computer-use:enable';
    setDependencyAction(actionKey);
    try {
      await api.enableComputerUse();
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      {(installsUnavailable || catalogUnavailable) && <SettingsReadError onRetry={() => load()}>
        {installsUnavailable && <p>{t.mcpInstallsReadonlyUnavailable}</p>}
        {catalogUnavailable && <p>{ts.pluginsCatalogUnavailable}</p>}
      </SettingsReadError>}
      {dependencies.length > 0 && (
        <Section>
          <SectionHeader icon={Package} action={!installsUnavailable && !catalogUnavailable && <SettingsRefreshButton onClick={() => load()} />}>{ts.mcpPluginDeps}</SectionHeader>
          <div className="flex flex-col gap-2">
            {dependencies.map(dependency => {
              const pluginInstalled = dependency.pluginInstalled ?? pluginServers.some(server => server.pluginName === dependency.pluginName);
              const dependencyServer = pluginServers.find(server => server.pluginName === dependency.pluginName);
              const statusText = formatPluginDependencyStatus(dependency, dependencyServer, ts);
              const dependencyLayerRows = formatPluginDependencyLayerRows(dependency, pluginInstalled, dependencyServer, ts);
              const isSettingUp = pendingActions.has('plugin:' + dependency.pluginName) || pendingActions.has(dependencyKey(dependency));
              const isInstalling = pendingActions.has(dependencyKey(dependency));
              const isUpdating = pendingActions.has(dependencyKey(dependency));
              const isDiagnosing = pendingActions.has(dependencyKey(dependency));
              const isRestartingMcp = pendingActions.has('retry:' + (dependencyServer?.name ?? ''));
              const isEnablingComputerUse = dependencyAction === 'computer-use:enable';
              const canReconnectMcp = dependency.state === 'ready' && Boolean(dependencyServer) && dependencyServer?.connected === false;
              const isComputerUse = dependency.pluginName === 'cua-computer-use';
              return (
                <Card key={`${dependency.pluginName}:${dependency.dependencyId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{formatPluginDependencyTitle(dependency)}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${pluginDependencyBadgeClass(dependency.state)}`}>
                          {statusText}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                        {dependency.displayName}
                        {dependency.version ? ` · ${dependency.version}` : ''}
                        {dependency.resolvedBinary ? ` · ${dependency.resolvedBinary}` : ''}
                      </div>
                      {dependency.detail && dependency.state !== 'ready' && (
                        <div className="mt-1 line-clamp-2 text-xs text-[var(--c-text-tertiary)]">
                          {dependency.detail}
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-[var(--c-text-secondary)] sm:grid-cols-2">
                        {dependencyLayerRows.map(row => (
                          <div key={row.label} className="min-w-0 truncate">
                            {row.label}：{row.value}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {dependency.task && (
                        <button type="button" disabled={dependency.task.state === 'cancelling' || pendingActions.has('cancel:' + dependencyKey(dependency))}
                          onClick={() => void handleCancelDependency(dependency)}
                          className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {dependency.task.state === 'cancelling' ? ts.mcpCancellingTask : ts.mcpCancelTask}
                        </button>
                      )}
                      {dependency.code === 'permission_accessibility_missing' && (
                        <button
                          type="button"
                          disabled={pendingActions.has('permission:accessibility')}
                          onClick={() => void handleOpenPermissionSettings('accessibility')}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                        >
                          <Settings size={12} />
                          {ts.mcpOpenAccessibility}
                        </button>
                      )}
                      {dependency.code === 'permission_screen_missing' && (
                        <button
                          type="button"
                          disabled={pendingActions.has('permission:screen')}
                          onClick={() => void handleOpenPermissionSettings('screen')}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                        >
                          <Settings size={12} />
                          {ts.mcpOpenScreenRecording}
                        </button>
                      )}
                      {canReconnectMcp && (
                        <button
                          type="button"
                          disabled={isComputerUse ? isEnablingComputerUse : isRestartingMcp}
                          onClick={() => void (isComputerUse ? handleEnableComputerUse() : handleRetryPluginComponent(dependencyServer?.name ?? ''))}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {(isComputerUse ? isEnablingComputerUse : isRestartingMcp) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {isComputerUse ? ts.mcpEnableComputerUse : (dependencyServer?.enabled === false ? ts.mcpConnectMcp : ts.mcpReconnectMcp)}
                        </button>
                      )}
                      {dependency.canInstall && dependency.state === 'missing' && !pluginInstalled && (
                        <button
                          type="button"
                          disabled={isSettingUp}
                          onClick={() => void handleSetupPluginDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {isSettingUp ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                          {ts.mcpInstallAndEnable}
                        </button>
                      )}
                      {dependency.canInstall && dependency.state === 'missing' && pluginInstalled && (
                        <button
                          type="button"
                          disabled={isInstalling}
                          onClick={() => void handleInstallDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {isInstalling ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                          {ts.mcpInstallDriver}
                        </button>
                      )}
                      {dependency.canUpdate && dependency.state !== 'missing' && (
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void handleUpdateDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                        >
                          {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {ts.mcpUpdate}
                        </button>
                      )}
                      {dependency.canDiagnose && (
                        <button
                          type="button"
                          disabled={isDiagnosing}
                          onClick={() => void handleDiagnoseDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                        >
                          {isDiagnosing ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
                          {ts.mcpDiagnose}
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {pluginServers.length > 0 && (
        <Section>
          <SectionHeader icon={Plug} action={dependencies.length === 0 && !installsUnavailable && !catalogUnavailable && <SettingsRefreshButton onClick={() => load()} />}>{ts.mcpPluginMcpServices}</SectionHeader>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {ts.mcpPluginMcpServicesDesc}
          </p>
          <div className="flex flex-col gap-2">
            {pluginServers.map(server => (
              <Card key={server.name}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${server.connected ? 'bg-green-500' : server.enabled ? 'bg-yellow-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="text-xs text-[var(--c-text-secondary)]">
                        {server.pluginName} · {server.toolCount} tools
                      </div>
                      {!server.connected && server.lastError && !server.lastErrorDetail?.category && (
                        <div className="mt-1 max-w-[420px] truncate text-xs text-[var(--c-text-tertiary)]">
                          {server.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${server.connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {server.connected ? ts.mcpConnected : ts.mcpDisconnected}
                  </span>
                </div>
                {!server.connected && server.lastErrorDetail?.category && (
                  <McpErrorRemediationBanner detail={server.lastErrorDetail} serverName={server.name} />
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <SectionHeader icon={Plug} action={dependencies.length === 0 && pluginServers.length === 0 && !installsUnavailable && !catalogUnavailable && <SettingsRefreshButton onClick={() => load()} />}>{ts.mcpServersTitle}</SectionHeader>
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {ts.mcpServersDesc}
        </p>

        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {ts.mcpAddServer}
        </button>

        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-mcp-server-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpNameLabel}</label>
                <input
                  id="desktop-mcp-server-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={ts.mcpNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-mcp-server-command" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpCommandLabel}</label>
                <input
                  id="desktop-mcp-server-command"
                  type="text"
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-mcp-server-args" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpArgsLabel}</label>
                <input
                  id="desktop-mcp-server-args"
                  type="text"
                  value={newArgs}
                  onChange={e => setNewArgs(e.target.value)}
                  placeholder="/path/to/allow"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleCreate} disabled={pendingActions.has('create')} className={btnPrimary}>{ts.mcpCreateBtn}</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>{ts.mcpCancelBtn}</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {!installsReady ? <Card>{t.mcpInstallsReadonlyUnknown}</Card> : installs.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {ts.mcpEmpty}
              </div>
            </Card>
          ) : (
            installs.map(install => (
              <Card key={install.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${install.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{install.name}</div>
                      <code className="text-xs text-[var(--c-text-secondary)] font-mono">
                        {install.command}{install.args?.length ? ` ${install.args.join(' ')}` : ''}
                      </code>
                      <div className="text-xs text-[var(--c-text-tertiary)]">
                        {ts.mcpSourceLabel} {install.source} · {ts.mcpCreatedAtLabel} {new Date(install.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button type="button"
                    aria-label={t.mcpInstallDeleteConfirm}
                    disabled={pendingActions.has('row:' + install.id)}
                    onClick={() => handleDelete(install.id)}
                    className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))
          )}
        </div>
      </Section>
    </>
  );
}
