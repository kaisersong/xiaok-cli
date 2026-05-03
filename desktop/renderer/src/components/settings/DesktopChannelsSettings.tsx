import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import {
  type ChannelResponse,
  type LlmProvider,
  type Persona,
  listChannelPersonas,
  listChannels,
  listLlmProviders,
} from '../../api'
import { useLocale } from '../../contexts/LocaleContext'
import { DesktopDiscordSettingsPanel } from './DesktopDiscordSettingsPanel'
import { DesktopFeishuSettingsPanel } from './DesktopFeishuSettingsPanel'
import { DesktopQQBotSettingsPanel } from './DesktopQQBotSettingsPanel'
import { DesktopQQSettingsPanel } from './DesktopQQSettingsPanel'
import { DesktopTelegramSettingsPanel } from './DesktopTelegramSettingsPanel'
import { DesktopWeixinSettingsPanel } from './DesktopWeixinSettingsPanel'

type Props = {
  accessToken: string
}

type IntegrationTab = 'telegram' | 'discord' | 'feishu' | 'qqbot' | 'qq' | 'weixin'

function TelegramIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function DiscordIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}

function QQIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673" />
    </svg>
  )
}

function WeixinIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-3.95-.093-7.332 2.836-7.332 6.547 0 3.622 3.263 6.572 7.242 6.572a7.1 7.1 0 0 0 2.07-.296.592.592 0 0 1 .518.074l1.388.812a.23.23 0 0 0 .12.039.215.215 0 0 0 .212-.215c0-.051-.02-.1-.035-.155l-.285-1.08a.43.43 0 0 1 .155-.484C22.048 19.708 23.2 18.158 23.2 16.41c0-3.622-2.855-6.434-6.262-7.552zm-3.215 3.98c.468 0 .848.386.848.86a.854.854 0 0 1-.848.86.854.854 0 0 1-.848-.86c0-.475.38-.86.848-.86zm4.804 0c.468 0 .848.386.848.86a.854.854 0 0 1-.848.86.854.854 0 0 1-.848-.86c0-.475.38-.86.848-.86z" />
    </svg>
  )
}

const PLATFORM_ICONS: Record<IntegrationTab, ReactNode> = {
  telegram: <TelegramIcon />,
  discord: <DiscordIcon />,
  feishu: <Send size={15} />,
  qqbot: <QQIcon />,
  qq: <QQIcon />,
  weixin: <WeixinIcon />,
}

export function DesktopChannelsSettings({ accessToken }: Props) {
  const { t } = useLocale()
  const ct = t.channels
  const [activeTab, setActiveTab] = useState<IntegrationTab>('telegram')
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<ChannelResponse[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [providers, setProviders] = useState<LlmProvider[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [allChannels, allPersonas] = await Promise.all([
        listChannels(accessToken),
        listChannelPersonas(accessToken).catch(() => [] as Persona[]),
      ])
      setChannels(allChannels)
      setPersonas(allPersonas)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listLlmProviders(accessToken).then(setProviders).catch(() => {})
  }, [accessToken])

  const telegramChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'telegram') ?? null,
    [channels],
  )
  const discordChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'discord') ?? null,
    [channels],
  )
  const qqChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'qq') ?? null,
    [channels],
  )
  const feishuChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'feishu') ?? null,
    [channels],
  )
  const qqBotChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'qqbot') ?? null,
    [channels],
  )
  const wxChannel = useMemo(
    () => channels.find((channel) => channel.channel_type === 'weixin') ?? null,
    [channels],
  )

  const tabItems: { key: IntegrationTab; label: string; channel: ChannelResponse | null }[] = [
    { key: 'telegram', label: ct.telegram, channel: telegramChannel },
    { key: 'discord', label: ct.discord, channel: discordChannel },
    { key: 'feishu', label: ct.feishu, channel: feishuChannel },
    { key: 'qqbot', label: ct.qq, channel: qqBotChannel },
    { key: 'qq', label: ct.qqOneBot, channel: qqChannel },
    { key: 'weixin', label: ct.weixin, channel: wxChannel },
  ]

  return (
    <div className="-m-6 flex min-h-0 min-w-0 overflow-hidden" style={{ height: 'calc(100% + 48px)' }}>
      {/* Platform list */}
      <div
        className="flex w-[200px] shrink-0 flex-col overflow-y-auto py-2"
        style={{ borderRight: '0.5px solid var(--c-border-subtle)' }}
      >
        <div className="flex flex-col gap-[3px] px-2">
          {tabItems.map(({ key, label, channel }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={[
                'flex h-[38px] items-center gap-2.5 truncate rounded-lg px-2.5 text-left text-[13px] font-medium transition-all duration-[120ms] active:scale-[0.97]',
                activeTab === key
                  ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-heading)]'
                  : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]',
              ].join(' ')}
            >
              <span className="shrink-0 text-[var(--c-text-muted)]">{PLATFORM_ICONS[key]}</span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {channel?.is_active && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-status-success-text)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[var(--c-text-muted)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : activeTab === 'telegram' ? (
          <DesktopTelegramSettingsPanel
            accessToken={accessToken}
            channel={telegramChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        ) : activeTab === 'discord' ? (
          <DesktopDiscordSettingsPanel
            accessToken={accessToken}
            channel={discordChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        ) : activeTab === 'feishu' ? (
          <DesktopFeishuSettingsPanel
            accessToken={accessToken}
            channel={feishuChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        ) : activeTab === 'qqbot' ? (
          <DesktopQQBotSettingsPanel
            accessToken={accessToken}
            channel={qqBotChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        ) : activeTab === 'weixin' ? (
          <DesktopWeixinSettingsPanel
            accessToken={accessToken}
            channel={wxChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        ) : (
          <DesktopQQSettingsPanel
            accessToken={accessToken}
            channel={qqChannel}
            personas={personas}
            providers={providers}
            reload={load}
          />
        )}
      </div>
    </div>
  )
}
