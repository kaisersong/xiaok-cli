import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '../../contexts/LocaleContext'
import { SettingsSection } from './_SettingsSection'

import type { PluginMcpServerDto, AvailablePluginDto } from '../../../../shared/plugin-catalog-ipc-contract';

export function PluginsSettings() {
  const { t } = useLocale()
  const ds = t.desktopSettings
  const [servers, setServers] = useState<PluginMcpServerDto[]>([])
  const [available, setAvailable] = useState<AvailablePluginDto[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  const [catalogUnavailable, setCatalogUnavailable] = useState(false)
  const readGeneration = useRef(0)
  const pendingRead = useRef<number | null>(null)
  const manualReread = useRef(false)
  const loadData = useCallback(async () => {
    if (pendingRead.current !== null) { manualReread.current = true; return }
    const generation = ++readGeneration.current
    pendingRead.current = generation
    try {
      const [serversList, availableList] = await Promise.allSettled([
        window.xiaokDesktop.listPluginMcpServers(),
        window.xiaokDesktop.listAvailablePlugins(),
      ])
      if (generation !== readGeneration.current) return
      if (serversList.status === 'fulfilled') setServers(serversList.value)
      if (availableList.status === 'fulfilled') setAvailable(availableList.value)
      setCatalogUnavailable(serversList.status === 'rejected' || availableList.status === 'rejected')
    } finally {
      if (pendingRead.current === generation) {
        pendingRead.current = null; setLoading(false)
        if (manualReread.current) { manualReread.current = false; void loadData() }
      }
    }
  }, [])

  useEffect(() => {
    void loadData()
    return () => { readGeneration.current += 1; pendingRead.current = null; manualReread.current = false }
  }, [loadData])

  const handleInstall = useCallback(async (name: string) => {
    setInstalling(name)
    setInstallError(null)
    try {
      const result = await window.xiaokDesktop.installPlugin(name)
      if (result.success) {
        await loadData()
      } else {
        setInstallError(result.error || ds.pluginsInstallFailed)
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(null)
    }
  }, [loadData])

  const installedNames = new Set(servers.map(s => s.pluginName || s.name))
  const uninstalled = available.filter(p => !installedNames.has(p.name))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[var(--c-text-secondary)]">
        {ds.pluginsCatalogLoading}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {catalogUnavailable && <div role="alert" className="text-xs text-red-500"><p>{ds.pluginsCatalogUnavailable}</p><button type="button" onClick={() => void loadData()}>{ds.pluginsCatalogRetry}</button></div>}
      <SettingsSection title={ds.pluginsInstalledTitle}>
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-[var(--c-text-secondary)]">
            <p>{ds.pluginsInstalledEmpty}</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--c-border-subtle)]">
            {servers.map((server) => (
              <div key={server.name} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-heading)]">{server.name}</span>
                    {server.connected && (
                      <span className="inline-block size-2 rounded-full bg-green-500" title={ds.mcpConnected} />
                    )}
                    {!server.connected && server.enabled && (
                      <span className="inline-block size-2 rounded-full bg-yellow-500" title={ds.mcpDisconnected} />
                    )}
                  </div>
                  <span className="text-xs text-[var(--c-text-tertiary)]">
                    {server.pluginName} · {ds.pluginsCatalogToolCount(server.toolCount)}
                  </span>
                </div>
                {/* Design v58 §7.2: the old toggle only mutated a view model — there was
                    no durable desired-state store behind it. Reserved renderers are
                    startup-active and CUA has its own persisted preference, so this is a
                    read-only status until a real per-server durable toggle is designed. */}
                <span
                  aria-label={server.name}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    server.connected
                      ? 'bg-[var(--c-accent)] text-white'
                      : 'bg-[var(--c-bg-deep)] text-[var(--c-text-tertiary)]'
                  }`}
                >
                  {server.connected ? ds.mcpConnected : ds.mcpDisconnected}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {uninstalled.length > 0 && (
        <SettingsSection title={ds.pluginsAvailableTitle}>
          <div className="flex flex-col divide-y divide-[var(--c-border-subtle)]">
            {uninstalled.map((plugin) => (
              <div key={plugin.name} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-[var(--c-text-heading)]">{plugin.display_name}</span>
                  <span className="text-xs text-[var(--c-text-tertiary)]">{plugin.description}</span>
                </div>
                <button
                  type="button"
                  disabled={installing === plugin.name}
                  onClick={() => handleInstall(plugin.name)}
                  className="px-3 py-1 text-xs rounded-md bg-[var(--c-accent)] text-white disabled:opacity-50"
                >
                  {installing === plugin.name
                    ? ds.pluginsInstalling
                    : ds.pluginsInstall}
                </button>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      {installError && (
        <div className="text-xs text-red-500 px-1">
          {ds.pluginsInstallFailed}: {installError}
        </div>
      )}

      <p className="text-xs text-[var(--c-text-tertiary)] px-1">
        {ds.pluginsRestartHint}
      </p>
    </div>
  )
}
