import { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import {
  type ChannelResponse,
  type LlmProvider,
  type Persona,
  createChannel,
  isApiError,
  updateChannel,
  verifyChannel,
} from '../../api'
import { CopyIconButton } from '../CopyIconButton'
import { useLocale } from '../../contexts/LocaleContext'
// TODO: migrate @arkloop/shared import: import { PillToggle } from '@arkloop/shared'
import {
  buildModelOptions,
  inputCls,
  ListField,
  mergeListValues,
  ModelDropdown,
  readStringArrayConfig,
  resolvePersonaID,
  sameItems,
  SaveActions,
  StatusBadge,
  TokenField,
} from './DesktopChannelSettingsShared'

type Props = {
  accessToken: string
  channel: ChannelResponse | null
  personas: Persona[]
  providers: LlmProvider[]
  reload: () => Promise<void>
}

function readStringConfig(channel: ChannelResponse | null, key: string): string {
  const raw = channel?.config_json?.[key]
  return typeof raw === 'string' ? raw : ''
}

export function DesktopFeishuSettingsPanel({
  accessToken,
  channel,
  personas,
  providers,
  reload,
}: Props) {
  const { t } = useLocale()
  const ct = t.channels
  const ds = t.desktopSettings

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(channel?.is_active ?? false)
  const [personaID, setPersonaID] = useState(resolvePersonaID(personas, channel?.persona_id))
  const [appID, setAppID] = useState(readStringConfig(channel, 'app_id'))
  const [domain, setDomain] = useState(readStringConfig(channel, 'domain') || 'feishu')
  const [appSecretDraft, setAppSecretDraft] = useState('')
  const [verificationTokenDraft, setVerificationTokenDraft] = useState('')
  const [encryptKeyDraft, setEncryptKeyDraft] = useState('')
  const [defaultModel, setDefaultModel] = useState(readStringConfig(channel, 'default_model'))
  const [allowedUserIDs, setAllowedUserIDs] = useState(readStringArrayConfig(channel, 'allowed_user_ids'))
  const [allowedUserInput, setAllowedUserInput] = useState('')
  const [allowedChatIDs, setAllowedChatIDs] = useState(readStringArrayConfig(channel, 'allowed_chat_ids'))
  const [allowedChatInput, setAllowedChatInput] = useState('')
  const [triggerKeywords, setTriggerKeywords] = useState(readStringArrayConfig(channel, 'trigger_keywords'))
  const [triggerKeywordInput, setTriggerKeywordInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    setEnabled(channel?.is_active ?? false)
    setPersonaID(resolvePersonaID(personas, channel?.persona_id))
    setAppID(readStringConfig(channel, 'app_id'))
    setDomain(readStringConfig(channel, 'domain') || 'feishu')
    setAppSecretDraft('')
    setVerificationTokenDraft('')
    setEncryptKeyDraft('')
    setDefaultModel(readStringConfig(channel, 'default_model'))
    setAllowedUserIDs(readStringArrayConfig(channel, 'allowed_user_ids'))
    setAllowedUserInput('')
    setAllowedChatIDs(readStringArrayConfig(channel, 'allowed_chat_ids'))
    setAllowedChatInput('')
    setTriggerKeywords(readStringArrayConfig(channel, 'trigger_keywords'))
    setTriggerKeywordInput('')
    setVerifyResult(null)
  }, [channel, personas])

  const modelOptions = useMemo(() => buildModelOptions(providers), [providers])
  const personaOptions = useMemo(
    () => personas.map((p) => ({ value: p.id, label: p.display_name || p.id })),
    [personas],
  )
  const persistedAppID = readStringConfig(channel, 'app_id')
  const persistedDomain = readStringConfig(channel, 'domain') || 'feishu'
  const persistedDefaultModel = readStringConfig(channel, 'default_model')
  const persistedAllowedUserIDs = useMemo(() => readStringArrayConfig(channel, 'allowed_user_ids'), [channel])
  const persistedAllowedChatIDs = useMemo(() => readStringArrayConfig(channel, 'allowed_chat_ids'), [channel])
  const persistedTriggerKeywords = useMemo(() => readStringArrayConfig(channel, 'trigger_keywords'), [channel])
  const effectiveAllowedUserIDs = useMemo(
    () => mergeListValues(allowedUserIDs, allowedUserInput),
    [allowedUserIDs, allowedUserInput],
  )
  const effectiveAllowedChatIDs = useMemo(
    () => mergeListValues(allowedChatIDs, allowedChatInput),
    [allowedChatIDs, allowedChatInput],
  )
  const effectiveTriggerKeywords = useMemo(
    () => mergeListValues(triggerKeywords, triggerKeywordInput).map((item) => item.toLowerCase()),
    [triggerKeywords, triggerKeywordInput],
  )
  const effectivePersonaID = useMemo(
    () => resolvePersonaID(personas, channel?.persona_id),
    [personas, channel?.persona_id],
  )
  const tokenConfigured = channel?.has_credentials === true
  const botName = readStringConfig(channel, 'bot_name')
  const botOpenID = readStringConfig(channel, 'bot_open_id')
  const botProfileLabel = [botName, botOpenID].filter(Boolean).join(' · ')

  const dirty = useMemo(() => {
    if ((channel?.is_active ?? false) !== enabled) return true
    if (effectivePersonaID !== personaID) return true
    if (appID.trim() !== persistedAppID) return true
    if (domain !== persistedDomain) return true
    if (defaultModel !== persistedDefaultModel) return true
    if (!sameItems(persistedAllowedUserIDs, effectiveAllowedUserIDs)) return true
    if (!sameItems(persistedAllowedChatIDs, effectiveAllowedChatIDs)) return true
    if (!sameItems(persistedTriggerKeywords, effectiveTriggerKeywords)) return true
    return appSecretDraft.trim().length > 0 ||
      verificationTokenDraft.trim().length > 0 ||
      encryptKeyDraft.trim().length > 0
  }, [
    appID,
    appSecretDraft,
    channel,
    defaultModel,
    domain,
    effectiveAllowedChatIDs,
    effectiveAllowedUserIDs,
    effectivePersonaID,
    effectiveTriggerKeywords,
    enabled,
    encryptKeyDraft,
    personaID,
    persistedAllowedChatIDs,
    persistedAllowedUserIDs,
    persistedAppID,
    persistedDefaultModel,
    persistedDomain,
    persistedTriggerKeywords,
    verificationTokenDraft,
  ])

  const createReady = channel !== null ||
    (appID.trim() !== '' &&
      appSecretDraft.trim() !== '' &&
      verificationTokenDraft.trim() !== '' &&
      encryptKeyDraft.trim() !== '' &&
      personaID !== '')
  const canSave = dirty && createReady

  const handleSave = async () => {
    if (!personaID) {
      setError(ct.personaRequired)
      return
    }
    if (appID.trim() === '') {
      setError(ct.feishuAppIDRequired)
      return
    }
    if (channel === null && (appSecretDraft.trim() === '' || verificationTokenDraft.trim() === '' || encryptKeyDraft.trim() === '')) {
      setError(ct.feishuCredentialsRequired)
      return
    }

    setSaving(true)
    setError('')
    try {
      const configJSON: Record<string, unknown> = {
        ...(channel?.config_json ?? {}),
        app_id: appID.trim(),
        domain,
        allowed_user_ids: effectiveAllowedUserIDs,
        allowed_chat_ids: effectiveAllowedChatIDs,
        trigger_keywords: effectiveTriggerKeywords,
      }
      if (defaultModel.trim()) configJSON.default_model = defaultModel.trim()
      else delete configJSON.default_model
      if (verificationTokenDraft.trim()) configJSON.verification_token = verificationTokenDraft.trim()
      if (encryptKeyDraft.trim()) configJSON.encrypt_key = encryptKeyDraft.trim()

      if (channel === null) {
        const created = await createChannel(accessToken, {
          channel_type: 'feishu',
          bot_token: appSecretDraft.trim(),
          persona_id: personaID,
          config_json: configJSON,
        })
        if (enabled) {
          await updateChannel(accessToken, created.id, { is_active: true })
        }
      } else {
        await updateChannel(accessToken, channel.id, {
          bot_token: appSecretDraft.trim() || undefined,
          persona_id: personaID || null,
          is_active: enabled,
          config_json: configJSON,
        })
      }

      setAppSecretDraft('')
      setVerificationTokenDraft('')
      setEncryptKeyDraft('')
      setAllowedUserIDs(effectiveAllowedUserIDs)
      setAllowedUserInput('')
      setAllowedChatIDs(effectiveAllowedChatIDs)
      setAllowedChatInput('')
      setTriggerKeywords(effectiveTriggerKeywords)
      setTriggerKeywordInput('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
      await reload()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError(ds.connectorSaveTimeout)
      } else {
        setError(isApiError(err) ? err.message : ct.saveFailed)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async () => {
    if (!channel) return
    setVerifying(true)
    setVerifyResult(null)
    try {
      const result = await verifyChannel(accessToken, channel.id)
      if (result.ok) {
        const parts = [
          result.application_name?.trim() || '',
          result.bot_user_id?.trim() || '',
        ].filter(Boolean)
        setVerifyResult({ ok: true, message: parts.join(' · ') || ds.connectorVerifyOk })
        await reload()
      } else {
        setVerifyResult({ ok: false, message: result.error ?? ds.connectorVerifyFail })
      }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? ds.connectorSaveTimeout
        : isApiError(err) ? err.message : ds.connectorVerifyFail
      setVerifyResult({ ok: false, message })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            border: '0.5px solid color-mix(in srgb, var(--c-status-error, #ef4444) 24%, transparent)',
            background: 'var(--c-status-error-bg, rgba(239,68,68,0.08))',
            color: 'var(--c-status-error-text, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      <div
        className="rounded-2xl p-5"
        style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-menu)' }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]">
                  <Send size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--c-text-heading)]">{ct.feishu}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge active={enabled} label={enabled ? ct.active : ct.inactive} />
                    <StatusBadge
                      active={tokenConfigured}
                      label={tokenConfigured ? ds.connectorConfigured : ds.connectorNotConfigured}
                    />
                    {botProfileLabel && (
                      <span className="rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] font-medium text-[var(--c-text-secondary)]">
                        {botProfileLabel}
                      </span>
                    )}
                    {verifyResult && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: verifyResult.ok
                            ? 'var(--c-status-success-bg, rgba(34,197,94,0.1))'
                            : 'var(--c-status-error-bg, rgba(239,68,68,0.08))',
                          color: verifyResult.ok
                            ? 'var(--c-status-success, #22c55e)'
                            : 'var(--c-status-error, #ef4444)',
                        }}
                      >
                        {verifyResult.message}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <PillToggle checked={enabled} onChange={(next) => { setEnabled(next); setSaved(false) }} />
          </div>

          {channel?.webhook_url && (
            <div className="flex min-w-0 items-center gap-2 rounded-lg bg-[var(--c-bg-deep)] px-3 py-2">
              <span className="shrink-0 text-xs font-medium text-[var(--c-text-secondary)]">{ct.webhookUrl}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--c-text-tertiary)]">
                {channel.webhook_url}
              </span>
              <CopyIconButton
                onCopy={() => navigator.clipboard.writeText(channel.webhook_url!)}
                size={13}
                tooltip={ct.webhookUrlCopy}
                className="shrink-0 text-[var(--c-text-muted)] hover:text-[var(--c-text-secondary)]"
              />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
                {ct.feishuAppID}
              </label>
              <input
                value={appID}
                onChange={(event) => {
                  setAppID(event.target.value)
                  setSaved(false)
                }}
                placeholder={ct.feishuAppIDPlaceholder}
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
                {ct.feishuDomain}
              </label>
              <select
                value={domain}
                onChange={(event) => {
                  setDomain(event.target.value)
                  setSaved(false)
                }}
                className={inputCls}
              >
                <option value="feishu">{ct.feishuDomainFeishu}</option>
                <option value="lark">{ct.feishuDomainLark}</option>
              </select>
            </div>

            <TokenField
              label={ct.feishuAppSecret}
              value={appSecretDraft}
              placeholder={tokenConfigured && !appSecretDraft ? ct.tokenAlreadyConfigured : ct.feishuAppSecretPlaceholder}
              onChange={(value) => {
                setAppSecretDraft(value)
                setSaved(false)
              }}
            />

            <TokenField
              label={ct.feishuVerificationToken}
              value={verificationTokenDraft}
              placeholder={tokenConfigured && !verificationTokenDraft ? ct.tokenAlreadyConfigured : ct.feishuVerificationTokenPlaceholder}
              onChange={(value) => {
                setVerificationTokenDraft(value)
                setSaved(false)
              }}
            />

            <TokenField
              label={ct.feishuEncryptKey}
              value={encryptKeyDraft}
              placeholder={tokenConfigured && !encryptKeyDraft ? ct.tokenAlreadyConfigured : ct.feishuEncryptKeyPlaceholder}
              onChange={(value) => {
                setEncryptKeyDraft(value)
                setSaved(false)
              }}
            />

            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
                {ct.persona}
              </label>
              <ModelDropdown
                value={personaID}
                options={personaOptions}
                placeholder={ct.personaDefault}
                disabled={saving}
                onChange={(value) => {
                  setPersonaID(value)
                  setSaved(false)
                }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[var(--c-text-secondary)]">
                {ds.connectorDefaultModel}
              </label>
              <ModelDropdown
                value={defaultModel}
                options={modelOptions}
                placeholder={ds.connectorDefaultModelPlaceholder}
                disabled={saving}
                onChange={(value) => {
                  setDefaultModel(value)
                  setSaved(false)
                }}
              />
            </div>

            <div
              className="md:col-span-2 rounded-xl px-4 py-4"
              style={{ border: '0.5px solid var(--c-border-subtle)', background: 'var(--c-bg-page)' }}
            >
              <div className="mb-4 text-sm font-medium text-[var(--c-text-heading)]">{ct.accessControl}</div>
              <div className="grid gap-4 md:grid-cols-2">
                <ListField
                  label={ct.feishuAllowedUsers}
                  values={allowedUserIDs}
                  inputValue={allowedUserInput}
                  placeholder={ct.feishuAllowedUsersPlaceholder}
                  addLabel={t.skills.add}
                  onInputChange={setAllowedUserInput}
                  onAdd={() => {
                    setAllowedUserIDs(mergeListValues(allowedUserIDs, allowedUserInput))
                    setAllowedUserInput('')
                    setSaved(false)
                  }}
                  onRemove={(value) => {
                    setAllowedUserIDs((current) => current.filter((item) => item !== value))
                    setSaved(false)
                  }}
                />

                <ListField
                  label={ct.feishuAllowedChats}
                  values={allowedChatIDs}
                  inputValue={allowedChatInput}
                  placeholder={ct.feishuAllowedChatsPlaceholder}
                  addLabel={t.skills.add}
                  onInputChange={setAllowedChatInput}
                  onAdd={() => {
                    setAllowedChatIDs(mergeListValues(allowedChatIDs, allowedChatInput))
                    setAllowedChatInput('')
                    setSaved(false)
                  }}
                  onRemove={(value) => {
                    setAllowedChatIDs((current) => current.filter((item) => item !== value))
                    setSaved(false)
                  }}
                />

                <ListField
                  label={ct.feishuTriggerKeywords}
                  values={triggerKeywords}
                  inputValue={triggerKeywordInput}
                  placeholder={ct.feishuTriggerKeywordsPlaceholder}
                  addLabel={t.skills.add}
                  onInputChange={setTriggerKeywordInput}
                  onAdd={() => {
                    setTriggerKeywords(mergeListValues(triggerKeywords, triggerKeywordInput).map((item) => item.toLowerCase()))
                    setTriggerKeywordInput('')
                    setSaved(false)
                  }}
                  onRemove={(value) => {
                    setTriggerKeywords((current) => current.filter((item) => item !== value))
                    setSaved(false)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <SaveActions
        saving={saving}
        saved={saved}
        dirty={dirty}
        canSave={canSave}
        canVerify={tokenConfigured}
        verifying={verifying}
        saveLabel={ct.save}
        savingLabel={ct.saving}
        verifyLabel={ds.connectorVerify}
        verifyingLabel={ds.connectorVerifying}
        savedLabel={ds.connectorSaved}
        onSave={() => void handleSave()}
        onVerify={() => void handleVerify()}
      />
    </div>
  )
}
