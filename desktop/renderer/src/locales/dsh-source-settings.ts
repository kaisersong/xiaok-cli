import type {
  DshDesktopMode,
  DshDesktopState,
} from '../../../shared/dsh-desktop';
export interface DshSourceSettingsLabels {
  title: string;
  description: string;
  freshnessHint: string;
  loading: string;
  refresh: string;
  unavailable: string;
  unknown: string;
  closing: string;
  pending: string;
  baselineHint: string;
  controlPending: string;
  modes: Record<DshDesktopMode, string>;
  scopes: Record<
    'global' | 'tenant' | 'workspace' | 'source_binding' | 'mandate',
    string
  >;
  apply: string;
  tenantId: string;
  tenantHint: string;
  owner: string;
  repository: string;
  selection: string;
  issueIds: string;
  labelIds: string;
  idsHint: string;
  configure: string;
  credential: string;
  credentialHint: string;
  connect: string;
  disconnect: string;
  reconcile: string;
  empty: string;
  connection: Record<DshDesktopState['sources'][number]['connection'], string>;
  lastScan: (when: string) => string;
  pagination: Record<'complete' | 'partial' | 'unknown', string>;
  scopePolicyConsent: string;
  egressTitle: string;
  provider: string;
  modelIds: string;
  destination: string;
  egressEnabled: string;
  saveEgress: string;
  egressPurposes: Record<'admission' | 'preview' | 'draft', string>;
  egressHint: string;
  textOnlyProfile: string;
  budgetTitle: string;
  mandateId: string;
  tokenLimit: string;
  costLimit: string;
  validUntil: string;
  saveBudget: string;
  budgetHint: string;
  budgetConfigured: string;
  authorizationTitle: string;
  source: string;
  actors: string;
  actions: Record<
    | 'source.read'
    | 'model.process_source'
    | 'local.draft.create'
    | 'local.draft.revise',
    string
  >;
  maxInputBytes: string;
  maxActiveWorks: string;
  maxDraftRuns: string;
  executionDeadline: string;
  egressPolicy: string;
  followup: string;
  observationEndsAt: string;
  publishMandate: string;
  authorizationHint: string;
  published: (id: string, revision: number) => string;
  loadFailed: string;
  operationFailed: string;
  invalidInput: string;
}
export const dshSourceSettingsZh: DshSourceSettingsLabels = {
  scopePolicyConsent:
    '我明确允许这项来源授权在全局、账户、工作区、来源和本授权五层应用授权、出口、隐私与只读政策。不会自动开启模式或授予工具资格。',
  egressTitle: '数据出口设置',
  provider: '模型服务商标识',
  modelIds: '允许的模型标识',
  destination: '模型目标引用',
  egressEnabled: '允许向此目标发送选定正文',
  saveEgress: '保存出口设置',
  egressPurposes: {
    admission: '准入分析',
    preview: '人工预览',
    draft: '草稿生成',
  },
  egressHint:
    '此处保存明确的数据范围与用途。保存记录不代表运行时已取得发送许可；每次请求仍核对当前配置、预算与原执行条件。',
  textOnlyProfile: '我选择仅模型文本处理合同；它不提供只读工具或自动执行资格。',
  budgetTitle: '模型预算',
  mandateId: '授权名称',
  tokenLimit: 'Token 总上限',
  costLimit: '美元预算上限',
  validUntil: '有效期（UTC）',
  saveBudget: '保存预算',
  budgetHint:
    '金额精确到百万分之一美元。预算上界记账不等同于服务商实际账单；修改授权不会清除已有花费或待确认额度。',
  budgetConfigured: '已绑定原预算账户',
  authorizationTitle: '处理授权',
  source: '授权来源',
  actors: '允许触发的 GitHub 用户 ID',
  actions: {
    'source.read': '读取所选内容',
    'model.process_source': '向已批准的模型处理内容',
    'local.draft.create': '创建本地草稿',
    'local.draft.revise': '更新本地草稿',
  },
  maxInputBytes: '单次输入字节上限',
  maxActiveWorks: '同时处理上限',
  maxDraftRuns: '每项草稿运行上限',
  executionDeadline: '执行截止时间（UTC）',
  egressPolicy: '数据出口策略引用',
  followup: '完成前继续观察后续消息',
  observationEndsAt: '后续观察截止时间（UTC）',
  publishMandate: '保存明确授权',
  authorizationHint:
    '仅授权已选择的来源、触发者和操作。运行资格、出口许可与真实只读执行条件仍须分别通过；保存授权不会自动开启执行。',
  published: (id, revision) => `授权 ${id} · 修订 ${revision}`,
  title: '自动草稿',
  freshnessHint:
    '自动处理只考虑开启后经过 5 分钟隔离期的可验证新事件；旧积压、边界和异常情况保留待审。这是保守产品规则，不是 GitHub 的时钟误差保证。',
  description:
    '在你明确授权的范围内观察 GitHub Issue，生成本地草稿。不会自动发布到 GitHub。',
  loading: '正在读取设置…',
  refresh: '刷新',
  unavailable: '当前尚未具备自动处理条件。',
  unknown: '执行状态尚未确认，请先刷新核对。',
  closing: '正在停止并回收当前操作…',
  pending: '授权与运行条件待确认',
  baselineHint:
    '连接前，请明确将全局、账户和工作区设为“仅观察”。连接后还需启用此来源；自动草稿需要另行完成授权与预算确认。',
  controlPending: '正在等待相关工作确认新的设置。',
  modes: { off: '关闭', observe: '仅观察', auto_draft: '自动生成草稿' },
  scopes: {
    global: '全局',
    tenant: '当前账户',
    workspace: '当前工作区',
    source_binding: '此来源',
    mandate: '此授权',
  },
  apply: '应用',
  tenantId: '账户标识',
  tenantHint:
    '明确选择此来源所属的本地账户范围；连接后仍须验证实际身份和仓库权限。',
  owner: 'GitHub 用户或组织',
  repository: '仓库名',
  selection: '选择范围',
  issueIds: 'Issue 对象 ID 与编号',
  labelIds: '标签 ID',
  idsHint:
    '标签模式填写标签 ID；Issue 模式填写“对象ID:#页面编号”。多个条目用逗号分隔，连接后会核对实际对象。',
  configure: '保存来源',
  credential: 'GitHub 访问令牌',
  credentialHint: '令牌仅在本次应用会话中保留，重新启动后需要重新连接。',
  connect: '连接',
  disconnect: '断开',
  reconcile: '立即检查',
  empty: '尚未配置来源。',
  connection: {
    credential_required: '需要连接',
    validating: '正在验证',
    connected: '已连接',
    unknown: '状态待核对',
    closing: '正在断开',
    closed: '已断开',
  },
  lastScan: (when) => `最近检查：${when}`,
  pagination: {
    complete: '内容已完整读取',
    partial: '内容未完整读取',
    unknown: '完整性待核对',
  },
  loadFailed: '无法读取设置，请重试。',
  operationFailed: '操作未能确认，请刷新核对当前状态。',
  invalidInput: '请核对来源、授权范围、UTC 时间与预算金额。',
};
export const dshSourceSettingsEn: DshSourceSettingsLabels = {
  scopePolicyConsent:
    'I explicitly allow mandate, egress, privacy and read-only policies for this source at global, account, workspace, source and mandate scopes. This does not enable modes or qualify tools.',
  egressTitle: 'Data egress settings',
  provider: 'Model provider identifier',
  modelIds: 'Allowed model identifiers',
  destination: 'Model destination reference',
  egressEnabled: 'Allow selected content to this destination',
  saveEgress: 'Save egress settings',
  egressPurposes: {
    admission: 'Admission assessment',
    preview: 'User preview',
    draft: 'Draft generation',
  },
  egressHint:
    'Save an explicit data scope and purposes. A saved record is not a runtime send permit. Every request still checks current settings, budget and original execution conditions.',
  textOnlyProfile:
    'I select a model-text-only contract. This does not qualify read-only tools or automatic execution.',
  budgetTitle: 'Model budget',
  mandateId: 'Authorization name',
  tokenLimit: 'Total token limit',
  costLimit: 'USD budget limit',
  validUntil: 'Valid until (UTC)',
  saveBudget: 'Save budget',
  budgetHint:
    'Amounts support six decimal places. Budget upper-bound accounting is not an actual provider invoice. Authorization revisions keep existing spending and unconfirmed holds.',
  budgetConfigured: 'Original budget account bound',
  authorizationTitle: 'Processing authorization',
  source: 'Authorized source',
  actors: 'Allowed GitHub actor IDs',
  actions: {
    'source.read': 'Read selected content',
    'model.process_source': 'Process content with an approved model',
    'local.draft.create': 'Create local drafts',
    'local.draft.revise': 'Revise local drafts',
  },
  maxInputBytes: 'Maximum input bytes',
  maxActiveWorks: 'Concurrent work limit',
  maxDraftRuns: 'Draft runs per work',
  executionDeadline: 'Execution deadline (UTC)',
  egressPolicy: 'Data egress policy reference',
  followup: 'Observe follow-up messages until completion',
  observationEndsAt: 'Follow-up observation ends (UTC)',
  publishMandate: 'Save explicit authorization',
  authorizationHint:
    'Authorize only the selected source, actors and actions. Execution qualification, egress permission and actual read-only execution checks still apply. Saving does not enable automatic execution.',
  published: (id, revision) => `Authorization ${id} · revision ${revision}`,
  title: 'Automatic drafts',
  freshnessHint:
    'Automatic processing considers verifiable new events after a five-minute activation quarantine. Backlog, boundary cases and anomalies remain for review. This conservative product rule is not a GitHub clock-error guarantee.',
  description:
    'Observe explicitly authorized GitHub issues and create local drafts. Nothing is automatically published to GitHub.',
  loading: 'Loading settings…',
  refresh: 'Refresh',
  unavailable: 'Automatic processing is not available yet.',
  unknown: 'The operation state is unconfirmed. Refresh to reconcile it.',
  closing: 'Stopping and draining current operations…',
  pending: 'Authorization and runtime checks are pending',
  baselineHint:
    'Before connecting, explicitly enable Observe only for global, account and workspace settings. Then enable the source. Automatic drafts require separate authorization and budget confirmation.',
  controlPending: 'Waiting for affected work to acknowledge the new settings.',
  modes: {
    off: 'Off',
    observe: 'Observe only',
    auto_draft: 'Create drafts automatically',
  },
  scopes: {
    global: 'Global',
    tenant: 'Current account',
    workspace: 'Current workspace',
    source_binding: 'This source',
    mandate: 'This authorization',
  },
  apply: 'Apply',
  tenantId: 'Account identifier',
  tenantHint:
    'Explicitly select the local account scope for this source. Connecting still verifies its actual identity and repository permissions.',
  owner: 'GitHub user or organization',
  repository: 'Repository',
  selection: 'Selection',
  issueIds: 'Issue object IDs and numbers',
  labelIds: 'Label IDs',
  idsHint:
    'For labels, enter label IDs. For issues, enter objectID:#pageNumber. Separate entries with commas; the actual objects are checked after connecting.',
  configure: 'Save source',
  credential: 'GitHub access token',
  credentialHint:
    'The token stays in this app session. Reconnect after restarting.',
  connect: 'Connect',
  disconnect: 'Disconnect',
  reconcile: 'Check now',
  empty: 'No sources configured.',
  connection: {
    credential_required: 'Connection required',
    validating: 'Validating',
    connected: 'Connected',
    unknown: 'Reconciliation required',
    closing: 'Disconnecting',
    closed: 'Disconnected',
  },
  lastScan: (when) => `Last checked: ${when}`,
  pagination: {
    complete: 'Content fully read',
    partial: 'Content incomplete',
    unknown: 'Completeness unconfirmed',
  },
  loadFailed: 'Unable to load settings. Try again.',
  operationFailed:
    'The operation could not be confirmed. Refresh to reconcile its state.',
  invalidInput:
    'Check the source, authorization scope, UTC times and budget amount.',
};
