import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '../../contexts/LocaleContext'
import { SettingsSection } from './_SettingsSection'

interface PluginMcpServer {
  name: string
  pluginName: string
  toolCount: number
  connected: boolean
  enabled: boolean
}

interface AvailablePlugin {
  name: string
  display_name: string
  description: string
  version: string
  installed: boolean
}

export function PluginsSettings() {
  const { locale } = useLocale()
  const [servers, setServers] = useState<PluginMcpServer[]>([])
  const [available, setAvailable] = useState<AvailablePlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [serversList, availableList] = await Promise.all([
        window.xiaokDesktop.listPluginMcpServers(),
        window.xiaokDesktop.listAvailablePlugins(),
      ])
      setServers(serversList)
      setAvailable(availableList)
    } catch {
      setServers([])
      setAvailable([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    setToggling(name)
    try {
      const updated = await window.xiaokDesktop.setPluginMcpServerEnabled({ name, enabled })
      setServers(updated)
    } catch { /* ignore */ }
    finally { setToggling(null) }
  }, [])

  const handleInstall = useCallback(async (name: string) => {
    setInstalling(name)
    setInstallError(null)
    try {
      const result = await window.xiaokDesktop.installPlugin(name)
      if (result.success) {
        await loadData()
      } else {
        setInstallError(result.error || '安装失败')
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
        Loading...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection title={locale === 'zh' ? '已安装的插件' : 'Installed Plugins'}>
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-[var(--c-text-secondary)]">
            <p>{locale === 'zh' ? '暂无已安装的插件 MCP 服务' : 'No plugin MCP servers installed'}</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--c-border-subtle)]">
            {servers.map((server) => (
              <div key={server.name} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-heading)]">{server.name}</span>
                    {server.connected && (
                      <span className="inline-block size-2 rounded-full bg-green-500" title="Connected" />
                    )}
                    {!server.connected && server.enabled && (
                      <span className="inline-block size-2 rounded-full bg-yellow-500" title="Not connected" />
                    )}
                  </div>
                  <span className="text-xs text-[var(--c-text-tertiary)]">
                    {server.pluginName} · {server.toolCount} tools
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={server.name}
                  disabled={toggling === server.name}
                  onClick={() => handleToggle(server.name, !server.enabled)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    server.enabled
                      ? 'bg-[var(--c-accent)]'
                      : 'bg-[var(--c-bg-deep)]'
                  } ${toggling === server.name ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
                      server.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {uninstalled.length > 0 && (
        <SettingsSection title={locale === 'zh' ? '可用插件' : 'Available Plugins'}>
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
                    ? (locale === 'zh' ? '安装中...' : 'Installing...')
                    : (locale === 'zh' ? '安装' : 'Install')}
                </button>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      {installError && (
        <div className="text-xs text-red-500 px-1">
          {locale === 'zh' ? '安装失败: ' : 'Install failed: '}{installError}
        </div>
      )}

      <p className="text-xs text-[var(--c-text-tertiary)] px-1">
        {locale === 'zh' ? '更改将在重启后生效' : 'Changes take effect after restart'}
      </p>
    </div>
  )
}
