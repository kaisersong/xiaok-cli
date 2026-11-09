/** Public DTOs only. Actor/grant issuance stays in main and is never a tool input. */
export interface ContinuityConversation {
  id: string;
  title: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  mode: 'chat' | 'work';
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  gtdBucket: 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived' | null;
  pinnedAt: number | null;
  currentTaskId: string | null;
  taskIds: string[];
  sidebar_work_folder?: string | null;
  revision: number;
  coverage: 'complete' | 'partial' | 'unclaimed';
}
export interface ContinuityMessage {
  messageId: string;
  revision: number;
  sequence: number;
  role: 'user' | 'assistant' | 'tool_summary';
  text: string;
  contentHash: string;
  sourceKind: 'desktop_task' | 'cli_session' | 'native_codex' | 'room';
  sourceId: string;
  sourceMessageId: string;
  observedAt: number;
  executionState: 'pending' | 'settled' | 'unknown';
  /** Exact user-claimed historical evidence; never proof of physical execution settlement. */
  visibilityBasis?: 'user_claimed_archive'|'authenticated_sync';
  truncated?: boolean;
}
export interface PublicTaskInput { prompt: string; includeUser: boolean }
export interface ContextReferenceView {
  refId: string;
  url: string;
  conversationId: string;
  snapshotRevision: number;
  contentHash: string;
}
export interface ContextReferencePage {
  refId: string;
  conversationId: string;
  snapshotRevision: number;
  messages: ContinuityMessage[];
  nextCursor?: string;
}
export interface CreateContextReferenceInput {
  conversationId: string;
  expectedRevision: number;
  operationId: string;
  firstMessageId?: string;
  lastMessageId?: string;
  sourceMessage?: { sourceId: string; sourceMessageId: string };
}
export interface ResolveContextReferenceInput { refId: string; cursor?: string; limit?: number }
export interface HistorySearchInput {
  query: string; limit?: number; sourceKinds?: Array<'desktop_task'|'cli_session'|'native_codex'>; after?: number; before?: number;
}
export interface HistorySearchHit {
  refId: string; url: string; conversationId: string; title: string|null;
  messageId: string; revision: number; contentHash: string; sourceKind: ContinuityMessage['sourceKind'];
  observedAt: number; executionState: ContinuityMessage['executionState']; visibilityBasis?: 'user_claimed_archive'|'authenticated_sync'; excerpt: string;
}
export interface HistorySearchResult {
  mode: 'keyword'; coverage: 'canonical_only'; scope: 'private_history'|'own_and_attached'; hits: HistorySearchHit[];
}
export function parseContextLink(value: string): string | null {
  // No URL normalization/decoding: encoded paths, extra actions and fragments are invalid.
  return /^xiaok:\/\/context\/v1\/([A-Za-z0-9_-]{32})$/.exec(value)?.[1] ?? null;
}
export interface LegacyContextPreview { previewId: string; legacyThreadId: string; title: string | null; manifestHash: string;
  sources: Array<{ taskId: string; messageCount: number; preview: string; status: string }>; coverage: 'partial' }
export type ContextConversationState = { id: string; state: 'active' | 'missing' | 'blocked' | 'deleted' };
export type LegacyDisplayMetadata=Partial<Pick<ContinuityConversation,'createdAt'|'updatedAt'|'mode'|'starred'|'pinnedAt'|'gtdBucket'|'sidebar_work_folder'>>;
export interface LegacyContextMetadataPage { id: string; title: string | null; metadata?:LegacyDisplayMetadata; taskIds: string[]; total: number; nextOffset?: number }
export interface ContextMcpStatus { enabled: boolean; state: 'disabled' | 'listening' | 'unavailable'; url: string | null }
export interface ExternalContextReaderView { credentialId: string; targetConversationId: string; refIds: string[]; revoked: boolean }
export interface AuthOwnerAccountView { accountId?: string }
export interface AuthOwnerStatusView { state: 'logged_out' | 'logging_in' | 'logged_in'; account?: AuthOwnerAccountView }
export interface AuthOwnerLoginAttemptView { authUrl: string; loginId: string }
export interface ContinuityDesktopApi {
  getAuthOwnerStatus(): Promise<AuthOwnerStatusView>;
  startAuthOwnerLogin(): Promise<AuthOwnerLoginAttemptView>;
  cancelAuthOwnerLogin(): Promise<void>;
  logoutAuthOwner(): Promise<void>;
  listCliArchives(input:{after?:string}):Promise<import('./cli-archive.js').CliArchiveList>;
  previewCliArchive(input:{sessionId:string;operationId:string}):Promise<import('./cli-archive.js').CliArchivePreview>;
  claimCliArchive(input:{previewId:string;manifestHash:string;operationId:string}):Promise<import('./cli-archive.js').CliArchiveClaim>;
  enqueueConversationInput(input:import('./conversation-inputs.js').EnqueueConversationInput):Promise<import('./conversation-inputs.js').ConversationInputAcceptance>;
  listConversationInputs(input:{conversationId:string}):Promise<import('./conversation-inputs.js').ConversationQueueView>;
  cancelConversationInput(input:{conversationId:string;inputId:string}):Promise<import('./conversation-inputs.js').ConversationQueueView>;
  onConversationInputsChanged(handler:(input:{conversationId:string})=>void):()=>void;
  searchContextHistory(input:HistorySearchInput):Promise<HistorySearchResult>;
  getHistorySearchConsent(input:{conversationId:string}):Promise<{enabled:boolean;revision:number}>;
  setHistorySearchConsent(input:{conversationId:string;enabled:boolean}):Promise<{enabled:boolean;revision:number}>;
  getContextMcpStatus(): Promise<ContextMcpStatus>;
  setContextMcpEnabled(input: { enabled: boolean }): Promise<ContextMcpStatus>;
  resetContextMcpPort(): Promise<ContextMcpStatus>;
  issueContextMcpConfig(input: { operationId: string; targetConversationId: string; refIds: string[] }): Promise<{ credentialId: string; clientConfig: string }>;
  listExternalContextReaders(): Promise<ExternalContextReaderView[]>;
  revokeExternalContextReader(input: { credentialId: string }): Promise<void>;
  importLegacyThreadMetadata(input: { legacyThreadId: string; title?: string; metadata?:LegacyDisplayMetadata; taskIds: string[]; operationId: string }): Promise<void>;
  getLegacyThreadMetadata(input: { legacyThreadId: string; offset?: number; limit?: number }): Promise<LegacyContextMetadataPage | null>;
  inspectContextConversations(input: { conversationIds: string[] }): Promise<ContextConversationState[]>;
  getContextGrant(input: { refId: string; targetConversationId: string }): Promise<{ grantId: string; basis?: 'explicit'|'history_search' } | null>;
  previewLegacyContext(input: { operationId: string; legacyThreadId: string; title?: string; metadata?:LegacyDisplayMetadata; taskIds: string[] }): Promise<LegacyContextPreview>;
  claimLegacyContext(input: { previewId: string; expectedManifestHash: string; operationId: string }): Promise<ContinuityConversation>;
  createContextConversation(input: { operationId: string; title?: string }): Promise<ContinuityConversation>;
  getContextConversation(input: { conversationId: string }): Promise<ContinuityConversation | null>;
  listContextConversations(input?: { limit?: number; before?: string }): Promise<ContinuityConversation[]>;
  updateContextConversation(input: { conversationId: string; patch: Partial<Pick<ContinuityConversation, 'title' | 'mode' | 'starred' | 'gtdBucket' | 'sidebar_work_folder'>> }): Promise<ContinuityConversation>;
  createContextReference(input: CreateContextReferenceInput): Promise<ContextReferenceView>;
  resolveContextReference(input: ResolveContextReferenceInput): Promise<ContextReferencePage>;
  attachContextReference(input: { refId: string; targetConversationId: string; operationId: string }): Promise<{ grantId: string }>;
  revokeContextGrant(input: { grantId: string }): Promise<void>;
}
export const CONTINUITY_CHANNELS = {
  getAuthOwnerStatus:'desktop:context:getAuthOwnerStatus',
  startAuthOwnerLogin:'desktop:context:startAuthOwnerLogin',
  cancelAuthOwnerLogin:'desktop:context:cancelAuthOwnerLogin',
  logoutAuthOwner:'desktop:context:logoutAuthOwner',
  listCliArchives:'desktop:context:listCliArchives',
  previewCliArchive:'desktop:context:previewCliArchive',
  claimCliArchive:'desktop:context:claimCliArchive',
  searchContextHistory:'desktop:context:searchHistory',
  getHistorySearchConsent:'desktop:context:getHistorySearchConsent',
  setHistorySearchConsent:'desktop:context:setHistorySearchConsent',
  getContextMcpStatus: 'desktop:context:getMcpStatus',
  setContextMcpEnabled: 'desktop:context:setMcpEnabled',
  resetContextMcpPort: 'desktop:context:resetMcpPort',
  issueContextMcpConfig: 'desktop:context:issueMcpConfig',
  listExternalContextReaders: 'desktop:context:listExternalReaders',
  revokeExternalContextReader: 'desktop:context:revokeExternalReader',
  importLegacyThreadMetadata: 'desktop:context:importLegacyMetadata',
  getLegacyThreadMetadata: 'desktop:context:getLegacyMetadata',
  inspectContextConversations: 'desktop:context:inspectConversations',
  getContextGrant: 'desktop:context:getGrant',
  previewLegacyContext: 'desktop:context:previewLegacy',
  claimLegacyContext: 'desktop:context:claimLegacy',
  createContextConversation: 'desktop:context:createConversation',
  getContextConversation: 'desktop:context:getConversation',
  listContextConversations: 'desktop:context:listConversations',
  updateContextConversation: 'desktop:context:updateConversation',
  createContextReference: 'desktop:context:createReference',
  resolveContextReference: 'desktop:context:resolveReference',
  attachContextReference: 'desktop:context:attachReference',
  revokeContextGrant: 'desktop:context:revokeGrant',
} as const;

export interface TaskEventCoordinate { taskId: string; eventIndex: number; sourceDataEpoch: string }
