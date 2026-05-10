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

export function PluginsSettings() {
  const { locale } = useLocale()
  const [servers, setServers] = useState<PluginMcpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const list = await window.xiaokDesktop.listPluginMcpServers()
      setServers(list)
    } catch {
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadServers() }, [loadServers])

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    setToggling(name)
    try {
      const updated = await window.xiaokDesktop.setPluginMcpServerEnabled({ name, enabled })
      setServers(updated)
    } catch { /* ignore */ }
    finally { setToggling(null) }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[var(--c-text-secondary)]">
        Loading...
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-[var(--c-text-secondary)]">
        <p>{locale === 'zh' ? '暂无已安装的插件 MCP 服务' : 'No plugin MCP servers installed'}</p>
        <p className="text-xs text-[var(--c-text-tertiary)]">
          {locale === 'zh' ? '插件安装到 ~/.xiaok/plugins/ 后会自动发现' : 'Plugins in ~/.xiaok/plugins/ are auto-discovered'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection title={locale === 'zh' ? '插件 MCP 服务' : 'Plugin MCP Servers'}>
        <div className="flex flex-col divide-y divide-[var(--c-border-subtle)]">
          {servers.map((server) => (
            <div key={server.name} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--c-text-heading)]">{server.name}</span>
                  {server.connected && (
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Connected" />
                  )}
                  {!server.connected && server.enabled && (
                    <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" title="Not connected" />
                  )}
                </div>
                <span className="text-xs text-[var(--c-text-tertiary)]">
                  {server.pluginName} · {server.toolCount} tools
                </span>
              </div>
              <button
                type="button"
                disabled={toggling === server.name}
                onClick={() => handleToggle(server.name, !server.enabled)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  server.enabled
                    ? 'bg-[var(--c-accent)]'
                    : 'bg-[var(--c-bg-deep)]'
                } ${toggling === server.name ? 'opacity-50' : ''}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    server.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </SettingsSection>
      <p className="text-xs text-[var(--c-text-tertiary)] px-1">
        {locale === 'zh' ? '更改将在重启后生效' : 'Changes take effect after restart'}
      </p>
    </div>
  )
}
