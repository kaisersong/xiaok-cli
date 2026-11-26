import { useChannelReadonly } from '../../hooks/useChannelReadonly';
import { useState, useEffect, useRef } from 'react';
import {
  Loader2,
  Check,
  X,
  Trash2,
  Plus,
  Globe,
  AlertCircle,
  Info,
  Zap,
} from 'lucide-react';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, SettingsRefreshButton, SettingsReadError, Section, Card, inputCls, btnPrimary, btnSecondary } from './settings-ui';

// ---- Channels ----

interface ChannelConfig {
  id: string;
  type: string;
  name: string;
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
  token?: string;
  botToken?: string;
  chatId?: string;
  corpId?: string;
  agentId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Channel type specific configuration fields (i18n-aware)
type ChannelTypeConfigMap = Record<string, { label: string; fields: Array<{ key: string; label: string; placeholder: string; required?: boolean }> }>;

function getChannelTypeConfig(ts: ReturnType<typeof useLocale>['t']['desktopSettings']): ChannelTypeConfigMap {
  return {
    yunzhijia: {
      label: ts.channelTypeYunzhijia,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldAppSecret, required: true },
        { key: 'token', label: 'Token', placeholder: ts.channelFieldToken },
      ],
    },
    feishu: {
      label: ts.channelTypeFeishu,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldFeishuAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldFeishuAppSecret, required: true },
      ],
    },
    discord: {
      label: ts.channelTypeDiscord,
      fields: [
        { key: 'botToken', label: 'Bot Token', placeholder: 'Discord Bot Token', required: true },
        { key: 'chatId', label: 'Channel ID', placeholder: ts.channelFieldDiscordChannelId },
      ],
    },
    weixin: {
      label: ts.channelTypeWeixin,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldWeixinAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldAppSecret, required: true },
        { key: 'token', label: 'Token', placeholder: ts.channelFieldWeixinToken },
      ],
    },
    qq: {
      label: ts.channelTypeQQ,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldQQAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: 'App Secret', required: true },
      ],
    },
    telegram: {
      label: ts.channelTypeTelegram,
      fields: [
        { key: 'botToken', label: 'Bot Token', placeholder: 'Telegram Bot Token', required: true },
        { key: 'chatId', label: 'Chat ID', placeholder: ts.channelFieldTelegramChatId },
      ],
    },
  };
}

export function ChannelsPane() {
  const channelFacts = useChannelReadonly();
  const channels: ChannelConfig[] = channelFacts.data ?? [];
  const loading = channelFacts.reading && channelFacts.data === null;
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState('yunzhijia');
  const [newName, setNewName] = useState('');
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { t, locale } = useLocale();
  const ts = t.desktopSettings;
  const channelTypeConfig = getChannelTypeConfig(ts);

  const load = channelFacts.refresh;

  type ActionOwner = { active: boolean; epoch: number; pending: Map<string, symbol> };
  type ActionLease = { owner: ActionOwner; epoch: number; token: symbol; keys: string[] };
  const actionOwner = useRef<ActionOwner>({ active: false, epoch: 0, pending: new Map() });
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());
  const testRevision = useRef(0);
  useEffect(() => {
    const owner = actionOwner.current;
    owner.active = true; owner.epoch += 1;
    setPendingActions(new Set(owner.pending.keys()));
    setError(''); setSuccess('');
    return () => {
      owner.active = false; owner.epoch += 1;
      testRevision.current += 1;
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

  // Reset fields when type changes
  useEffect(() => {
    setNewFields({});
  }, [newType]);

  const handleCreate = async () => {
    if (!actionOwner.current.active || actionOwner.current.pending.has('create') || !newName.trim()) return;
    const typeConfig = channelTypeConfig[newType];
    for (const field of typeConfig.fields) {
      if (field.required && !newFields[field.key]?.trim()) {
        alert(ts.channelsFieldRequired(field.label));
        return;
      }
    }
    const lease = beginAction(['create', 'row:' + newType]);
    if (!lease) return;
    try {
      await api.createChannel({ type: newType, name: newName.trim(), ...newFields });
      if (!isCurrentAction(lease)) return;
      setNewName(''); setNewFields({}); setShowAdd(false);
      load();
    } catch {
      if (isCurrentAction(lease)) alert(t.channelMutationFailed);
    } finally { finishAction(lease); }
  };

  const handleDelete = async (id: string) => {
    if (!actionOwner.current.active || actionOwner.current.pending.has('row:' + id)) return;
    if (!confirm(ts.channelsDeleteConfirm)) return;
    const lease = beginAction(['row:' + id]);
    if (!lease) return;
    try {
      await api.deleteChannel(id);
      if (isCurrentAction(lease)) load();
    } catch {
      if (isCurrentAction(lease)) alert(t.channelMutationFailed);
    } finally { finishAction(lease); }
  };

  const handleToggle = async (channel: ChannelConfig) => {
    const lease = beginAction(['row:' + channel.id]);
    if (!lease) return;
    try {
      await api.updateChannel(channel.id, { enabled: !channel.enabled });
      if (isCurrentAction(lease)) load();
    } catch {
      if (isCurrentAction(lease)) alert(t.channelMutationFailed);
    } finally { finishAction(lease); }
  };

  const handleTest = async (id: string) => {
    const lease = beginAction(['test:' + id]);
    if (!lease) return;
    const revision = ++testRevision.current;
    setError(''); setSuccess('');
    try {
      const result = await api.testChannel(id);
      if (!isCurrentAction(lease) || revision !== testRevision.current) return;
      if (result.success) setSuccess(ts.channelsTestSuccess(result.latencyMs ?? 0));
      else setError(result.error?.startsWith('channel_mcp_mutation_') ? ts.channelsTestFailed : result.error || ts.channelsTestFailed);
    } catch {
      if (isCurrentAction(lease) && revision === testRevision.current) setError(ts.channelsTestFailed);
    } finally { finishAction(lease); }
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
      {channelFacts.failed && <SettingsReadError onRetry={load}>{t.channelReadonlyUnavailable}</SettingsReadError>}
      <Section>
        <SectionHeader icon={Globe} action={!channelFacts.failed && <SettingsRefreshButton onClick={load} />}>{channelFacts.data === null ? t.channelReadonlyUnknown : ts.channelsTitle}</SectionHeader>
        {/* Status messages */}
        {success && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">
            <Check size={16} />
            {success}
            <button type="button" onClick={() => setSuccess('')} className="ml-auto text-green-600 hover:text-green-700">
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {error}
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {ts.channelsDesc}
        </p>

        {/* Add button */}
        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {ts.channelsAdd}
        </button>

        {/* Add form */}
        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-channel-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.channelsNameLabel}</label>
                <input
                  id="desktop-channel-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={ts.channelsNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-channel-type" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.channelsTypeLabel}</label>
                <select
                  id="desktop-channel-type"
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className={inputCls}
                >
                  {Object.entries(channelTypeConfig).map(([type, cfg]) => (
                    <option key={type} value={type}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              {/* Type-specific fields */}
              {channelTypeConfig[newType].fields.map(field => (
                <div key={field.key}>
                  <label htmlFor={`desktop-channel-field-${field.key}`} className="block text-xs text-[var(--c-text-secondary)] mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input aria-label={field.placeholder}
                    id={`desktop-channel-field-${field.key}`}
                    type="text"
                    value={newFields[field.key] || ''}
                    onChange={e => setNewFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className={inputCls}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={handleCreate} disabled={pendingActions.has('create')} className={btnPrimary}>{ts.channelsCreateBtn}</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>{ts.channelsCancelBtn}</button>
              </div>
            </div>
          </Card>
        )}

        {/* Channel list */}
        <div className="flex flex-col gap-2">
          {channelFacts.data === null ? <p>{t.channelReadonlyUnknown}</p> : channels.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {ts.channelsEmpty}
              </div>
            </Card>
          ) : (
            channels.map(ch => (
              <Card key={ch.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${ch.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{ch.name}</div>
                      <div className="text-xs text-[var(--c-text-secondary)]">
                        {channelTypeConfig[ch.type]?.label || ch.type} · {ts.channelsCreatedAt} {new Date(ch.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => void handleTest(ch.id)}
                      disabled={pendingActions.has('test:' + ch.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                    >
                      {pendingActions.has('test:' + ch.id) ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      {ts.channelsTestBtn}
                    </button>
                    <button type="button"
                      disabled={pendingActions.has('row:' + ch.id)}
                      onClick={() => handleToggle(ch)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        ch.enabled ? 'bg-green-50 text-green-600' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                      }`}
                    >
                      {ch.enabled ? ts.channelsEnabled : ts.channelsDisabled}
                    </button>
                    <button type="button"
                      aria-label={ts.channelsDeleteConfirm}
                      disabled={pendingActions.has('row:' + ch.id)}
                      onClick={() => handleDelete(ch.id)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </Section>
    </>
  );
}
