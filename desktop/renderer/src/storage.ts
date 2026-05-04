// Storage shim for xiaok desktop — localStorage-based implementations

export type Theme = 'system' | 'light' | 'dark'
export type AppMode = 'chat' | 'work'

// ---- Theme & Locale ----

export function readThemeFromStorage(): Theme {
  try { return (localStorage.getItem('xiaok:theme') as Theme) || 'system' } catch { return 'system' }
}
export function writeThemeToStorage(theme: Theme): void {
  try { localStorage.setItem('xiaok:theme', theme) } catch { /* noop */ }
}

export function readLocaleFromStorage(): 'zh' | 'en' {
  try { return (localStorage.getItem('xiaok:locale') as 'zh' | 'en') || 'zh' } catch { return 'zh' }
}
export function writeLocaleToStorage(locale: 'zh' | 'en'): void {
  try { localStorage.setItem('xiaok:locale', locale) } catch { /* noop */ }
}

// ---- GTD ----

export function readGtdEnabled(): boolean {
  try { return localStorage.getItem('xiaok:gtd-enabled') === 'true' } catch { return false }
}
export function writeGtdEnabled(v: boolean): void {
  try { localStorage.setItem('xiaok:gtd-enabled', String(v)) } catch { /* noop */ }
}

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
function writeSet(key: string, ids: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...ids])) } catch { /* noop */ }
}

export function readGtdInboxThreadIds(): Set<string> { return readSet('xiaok:gtd:inbox') }
export function writeGtdInboxThreadIds(ids: Set<string>): void { writeSet('xiaok:gtd:inbox', ids) }
export function readGtdTodoThreadIds(): Set<string> { return readSet('xiaok:gtd:todo') }
export function writeGtdTodoThreadIds(ids: Set<string>): void { writeSet('xiaok:gtd:todo', ids) }
export function readGtdWaitingThreadIds(): Set<string> { return readSet('xiaok:gtd:waiting') }
export function writeGtdWaitingThreadIds(ids: Set<string>): void { writeSet('xiaok:gtd:waiting', ids) }
export function readGtdSomedayThreadIds(): Set<string> { return readSet('xiaok:gtd:someday') }
export function writeGtdSomedayThreadIds(ids: Set<string>): void { writeSet('xiaok:gtd:someday', ids) }
export function readGtdArchivedThreadIds(): Set<string> { return readSet('xiaok:gtd:archived') }
export function writeGtdArchivedThreadIds(ids: Set<string>): void { writeSet('xiaok:gtd:archived', ids) }
export function readPinnedThreadIds(): Set<string> { return readSet('xiaok:pinned') }
export function writePinnedThreadIds(ids: Set<string>): void { writeSet('xiaok:pinned', ids) }

// ---- Search thread tracking ----

export function addSearchThreadId(threadId: string): void {
  const ids = readSet('xiaok:search-threads'); ids.add(threadId); writeSet('xiaok:search-threads', ids)
}
export function isSearchThreadId(threadId: string): boolean {
  return readSet('xiaok:search-threads').has(threadId)
}

// ---- Work folder ----

export function readWorkFolder(): string | null {
  try { return localStorage.getItem('xiaok:work-folder') } catch { return null }
}
export function writeWorkFolder(folder: string): void {
  try { localStorage.setItem('xiaok:work-folder', folder) } catch { /* noop */ }
}
export function clearWorkFolder(): void {
  try { localStorage.removeItem('xiaok:work-folder') } catch { /* noop */ }
}
export function readThreadWorkFolder(threadId: string): string | null {
  try { return localStorage.getItem(`xiaok:thread-work-folder:${threadId}`) } catch { return null }
}
export function writeThreadWorkFolder(threadId: string, folder: string): void {
  try { localStorage.setItem(`xiaok:thread-work-folder:${threadId}`, folder) } catch { /* noop */ }
}
export function clearThreadWorkFolder(threadId: string): void {
  try { localStorage.removeItem(`xiaok:thread-work-folder:${threadId}`) } catch { /* noop */ }
}
export function transferGlobalWorkFolderToThread(_threadId: string): void { /* noop */ }
export function transferGlobalThinkingToThread(_threadId: string): void { /* noop */ }
export function readWorkRecentFolders(): string[] { return [] }

// ---- Active thread ----

export function readActiveThreadIdFromStorage(): string | null {
  try { return localStorage.getItem('xiaok:active-thread-id') } catch { return null }
}
export function writeActiveThreadIdToStorage(threadId: string): void {
  try { localStorage.setItem('xiaok:active-thread-id', threadId) } catch { /* noop */ }
}
export function clearActiveThreadIdInStorage(): void {
  try { localStorage.removeItem('xiaok:active-thread-id') } catch { /* noop */ }
}

// ---- Run seq tracking ----

export function readLastSeqFromStorage(runId: string): number {
  try { return Number(localStorage.getItem(`xiaok:run-seq:${runId}`)) || 0 } catch { return 0 }
}
export function writeLastSeqToStorage(runId: string, seq: number): void {
  try { localStorage.setItem(`xiaok:run-seq:${runId}`, String(seq)) } catch { /* noop */ }
}
export function clearLastSeqInStorage(runId: string): void {
  try { localStorage.removeItem(`xiaok:run-seq:${runId}`) } catch { /* noop */ }
}

// ---- App mode ----

export function readAppModeFromStorage(): AppMode {
  try { return (localStorage.getItem('xiaok:app-mode') as AppMode) || 'work' } catch { return 'work' }
}
export function writeAppModeFromStorage(mode: AppMode): void {
  try { localStorage.setItem('xiaok:app-mode', mode) } catch { /* noop */ }
}
export function readLegacyThreadModesForMigration(): Record<string, AppMode> {
  try { return JSON.parse(localStorage.getItem('xiaok:legacy-thread-modes') || '{}') } catch { return {} }
}
export function writeLegacyThreadModesForMigration(modes: Record<string, AppMode>): void {
  try { localStorage.setItem('xiaok:legacy-thread-modes', JSON.stringify(modes)) } catch { /* noop */ }
}

// ---- Developer settings ----

export function readDeveloperShowRunEvents(): boolean {
  try { return localStorage.getItem('xiaok:dev:show-run-events') === 'true' } catch { return false }
}
export function writeDeveloperShowRunEvents(value: boolean): void {
  try { localStorage.setItem('xiaok:dev:show-run-events', String(value)) } catch { /* noop */ }
}
export function readDeveloperMode(): boolean {
  try { return localStorage.getItem('xiaok:dev:mode') === 'true' } catch { return false }
}
export function writeDeveloperMode(value: boolean): void {
  try { localStorage.setItem('xiaok:dev:mode', String(value)) } catch { /* noop */ }
}
export function readDeveloperShowDebugPanel(): boolean {
  try { return localStorage.getItem('xiaok:dev:show-debug-panel') === 'true' } catch { return false }
}
export function writeDeveloperShowDebugPanel(value: boolean): void {
  try { localStorage.setItem('xiaok:dev:show-debug-panel', String(value)) } catch { /* noop */ }
}
export function readDeveloperPipelineTraceEnabled(): boolean { return false }
export function writeDeveloperPipelineTraceEnabled(_value: boolean): void { /* noop */ }
export function readDeveloperPromptCacheDebugEnabled(): boolean { return false }
export function writeDeveloperPromptCacheDebugEnabled(_value: boolean): void { /* noop */ }

// ---- Expanded project paths ----

export function readExpandedProjectPaths(): Set<string> { return readSet('xiaok:expanded-project-paths') }
export function writeExpandedProjectPaths(paths: Set<string>): void { writeSet('xiaok:expanded-project-paths', paths) }

// ---- Font settings ----

export type FontSize = 'small' | 'default' | 'large'
export type FontFamily = string
export type CodeFontFamily = string

export interface FontSettings {
  fontSize: FontSize
  fontFamily: FontFamily
  codeFontFamily: CodeFontFamily
}

export function readFontSettingsFromStorage(): FontSettings {
  try {
    const raw = localStorage.getItem('xiaok:font-settings')
    return raw ? JSON.parse(raw) : { fontSize: 'default', fontFamily: '', codeFontFamily: '' }
  } catch { return { fontSize: 'default', fontFamily: '', codeFontFamily: '' } }
}
export function writeFontSettingsToStorage(settings: FontSettings): void {
  try { localStorage.setItem('xiaok:font-settings', JSON.stringify(settings)) } catch { /* noop */ }
}

// ---- Theme presets ----

export type ThemePreset = 'light' | 'dark' | 'system' | 'ocean' | 'forest' | 'sunset'
export interface ThemeDefinition { name: string; colors: Record<string, string> }

export function readThemePresetFromStorage(): ThemePreset {
  try { return (localStorage.getItem('xiaok:theme-preset') as ThemePreset) || 'system' } catch { return 'system' }
}
export function writeThemePresetToStorage(preset: ThemePreset): void {
  try { localStorage.setItem('xiaok:theme-preset', preset) } catch { /* noop */ }
}
export function readCustomThemeIdFromStorage(): string | null {
  try { return localStorage.getItem('xiaok:custom-theme-id') } catch { return null }
}
export function writeCustomThemeIdToStorage(id: string | null): void {
  try { if (id) localStorage.setItem('xiaok:custom-theme-id', id); else localStorage.removeItem('xiaok:custom-theme-id') } catch { /* noop */ }
}
export function readCustomThemesFromStorage(): Record<string, ThemeDefinition> {
  try { return JSON.parse(localStorage.getItem('xiaok:custom-themes') || '{}') } catch { return {} }
}
export function writeCustomThemesToStorage(themes: Record<string, ThemeDefinition>): void {
  try { localStorage.setItem('xiaok:custom-themes', JSON.stringify(themes)) } catch { /* noop */ }
}
export function readCustomBodyFontFromStorage(): string | null {
  try { return localStorage.getItem('xiaok:custom-body-font') } catch { return null }
}
export function writeCustomBodyFontToStorage(font: string | null): void {
  try { if (font) localStorage.setItem('xiaok:custom-body-font', font); else localStorage.removeItem('xiaok:custom-body-font') } catch { /* noop */ }
}

// ---- Message metadata types ----

export type WebSource = { url: string; title?: string; snippet?: string; index?: number }
export type ArtifactRef = { artifactId: string; type: string; title?: string }
export type WidgetRef = { widgetId: string; type: string }
export type BrowserActionRef = { actionId: string; type: string; url?: string }
export type CodeExecutionRef = { executionId: string; language?: string; status?: string }
export type ThinkingSegmentRef = { segmentId: string; type?: string }
export type MessageThinkingRef = { segments: ThinkingSegmentRef[] }
export type MessageSearchStepRef = { stepId: string; query?: string }
export type MemoryActionRef = { actionId: string; type?: string }
export type FileOpRef = { opId: string; path?: string; type?: string }
export type CopBlockRef = { blockId: string; type?: string }
export type CopBlockItem = { blockId: string; type?: string }
export type SubAgentStatus = 'spawning' | 'active' | 'completed' | 'failed' | 'closed'
export type SubAgentRef = { agentId: string; name?: string; status?: SubAgentStatus; nickname?: string; personaId?: string; role?: string; input?: string; output?: string; error?: string }
export type WebFetchRef = { fetchId: string; url?: string }
export type MessageTerminalStatusRef = 'completed' | 'cancelled' | 'interrupted' | 'failed'
export type MsgRunEvent = { seq: number; type: string; data?: unknown }
export type ThreadRunHandoffRef = { runId: string; lastSeq?: number }
export type TurnToolCallRef = { toolCallId: string; name: string }
export type AssistantTurnSegment = { type: string; text?: string; toolCall?: TurnToolCallRef }
export type AssistantTurnUi = { segments: AssistantTurnSegment[] }

export type MessageCopBlocksRef = { blocks: CopBlockItem[] }

export type InputDraftScope = { threadId: string; runId?: string }
export type DraftAttachmentRecord = { attachmentId: string; fileName: string; fileSize: number }

// ---- Message metadata accessors ----

function readJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* noop */ }
}

export function readMessageSources(id: string): WebSource[] | null { return readJson(`xiaok:msg:sources:${id}`) }
export function writeMessageSources(id: string, sources: WebSource[]): void { writeJson(`xiaok:msg:sources:${id}`, sources) }
export function readMessageArtifacts(id: string): ArtifactRef[] | null { return readJson(`xiaok:msg:artifacts:${id}`) }
export function writeMessageArtifacts(id: string, artifacts: ArtifactRef[]): void { writeJson(`xiaok:msg:artifacts:${id}`, artifacts) }
export function readMessageWidgets(id: string): WidgetRef[] | null { return readJson(`xiaok:msg:widgets:${id}`) }
export function writeMessageWidgets(id: string, widgets: WidgetRef[]): void { writeJson(`xiaok:msg:widgets:${id}`, widgets) }
export function readMessageBrowserActions(id: string): BrowserActionRef[] | null { return readJson(`xiaok:msg:browser-actions:${id}`) }
export function writeMessageBrowserActions(id: string, actions: BrowserActionRef[]): void { writeJson(`xiaok:msg:browser-actions:${id}`, actions) }
export function readMessageCodeExecutions(id: string): CodeExecutionRef[] | null { return readJson(`xiaok:msg:code-exec:${id}`) }
export function writeMessageCodeExecutions(id: string, executions: CodeExecutionRef[]): void { writeJson(`xiaok:msg:code-exec:${id}`, executions) }
export function readMessageThinking(id: string): MessageThinkingRef | null { return readJson(`xiaok:msg:thinking:${id}`) }
export function writeMessageThinking(id: string, thinking: MessageThinkingRef): void { writeJson(`xiaok:msg:thinking:${id}`, thinking) }
export function readMessageSearchSteps(id: string): MessageSearchStepRef[] | null { return readJson(`xiaok:msg:search-steps:${id}`) }
export function writeMessageSearchSteps(id: string, steps: MessageSearchStepRef[]): void { writeJson(`xiaok:msg:search-steps:${id}`, steps) }
export function readMessageMemoryActions(id: string): MemoryActionRef[] | null { return readJson(`xiaok:msg:memory-actions:${id}`) }
export function writeMessageMemoryActions(id: string, actions: MemoryActionRef[]): void { writeJson(`xiaok:msg:memory-actions:${id}`, actions) }
export function readMessageCopBlocks(id: string): MessageCopBlocksRef | null { return readJson(`xiaok:msg:cop-blocks:${id}`) }
export function writeMessageCopBlocks(id: string, data: MessageCopBlocksRef): void { writeJson(`xiaok:msg:cop-blocks:${id}`, data) }
export function readMessageAssistantTurn(id: string): AssistantTurnUi | null { return readJson(`xiaok:msg:assistant-turn:${id}`) }
export function writeMessageAssistantTurn(id: string, data: AssistantTurnUi): void { writeJson(`xiaok:msg:assistant-turn:${id}`, data) }
export function clearMessageAssistantTurn(id: string): void { try { localStorage.removeItem(`xiaok:msg:assistant-turn:${id}`) } catch { /* noop */ } }
export function readMessageFileOps(id: string): FileOpRef[] | null { return readJson(`xiaok:msg:file-ops:${id}`) }
export function writeMessageFileOps(id: string, ops: FileOpRef[]): void { writeJson(`xiaok:msg:file-ops:${id}`, ops) }
export function readMessageSubAgents(id: string): SubAgentRef[] | null { return readJson(`xiaok:msg:sub-agents:${id}`) }
export function writeMessageSubAgents(id: string, agents: SubAgentRef[]): void { writeJson(`xiaok:msg:sub-agents:${id}`, agents) }
export function readMessageWebFetches(id: string): WebFetchRef[] | null { return readJson(`xiaok:msg:web-fetches:${id}`) }
export function writeMessageWebFetches(id: string, fetches: WebFetchRef[]): void { writeJson(`xiaok:msg:web-fetches:${id}`, fetches) }
export function readMessageCoveredRunIds(id: string): string[] | null { return readJson(`xiaok:msg:covered-run-ids:${id}`) }
export function writeMessageCoveredRunIds(id: string, ids: string[]): void { writeJson(`xiaok:msg:covered-run-ids:${id}`, ids) }
export function readMessageTerminalStatus(id: string): MessageTerminalStatusRef | null { try { return localStorage.getItem(`xiaok:msg:terminal-status:${id}`) as MessageTerminalStatusRef | null } catch { return null } }
export function writeMessageTerminalStatus(id: string, status: MessageTerminalStatusRef): void { try { localStorage.setItem(`xiaok:msg:terminal-status:${id}`, status) } catch { /* noop */ } }
export function readMsgRunEvents(id: string): MsgRunEvent[] | null { return readJson(`xiaok:msg:run-events:${id}`) }
export function writeMsgRunEvents(id: string, events: MsgRunEvent[]): void { writeJson(`xiaok:msg:run-events:${id}`, events) }

// ---- Thread run handoff ----

export function readThreadRunHandoff(threadId: string): ThreadRunHandoffRef | null { return readJson(`xiaok:thread-run-handoff:${threadId}`) }
export function writeThreadRunHandoff(threadId: string, data: ThreadRunHandoffRef): void { writeJson(`xiaok:thread-run-handoff:${threadId}`, data) }
export function clearThreadRunHandoff(threadId: string): void { try { localStorage.removeItem(`xiaok:thread-run-handoff:${threadId}`) } catch { /* noop */ } }

// ---- Persona/Model selection ----

export function readSelectedPersonaKeyFromStorage(): string { try { return localStorage.getItem('xiaok:selected-persona') || 'normal' } catch { return 'normal' } }
export function writeSelectedPersonaKeyFromStorage(personaKey: string): void { try { localStorage.setItem('xiaok:selected-persona', personaKey) } catch { /* noop */ } }
export function readSelectedModelFromStorage(): string | null { try { return localStorage.getItem('xiaok:selected-model') } catch { return null } }
export function writeSelectedModelToStorage(model: string | null): void { try { if (model) localStorage.setItem('xiaok:selected-model', model); else localStorage.removeItem('xiaok:selected-model') } catch { /* noop */ } }
export function readSelectedReasoningMode(): string { try { return localStorage.getItem('xiaok:selected-reasoning') || 'auto' } catch { return 'auto' } }
export function writeSelectedReasoningMode(mode: string): void { try { localStorage.setItem('xiaok:selected-reasoning', mode) } catch { /* noop */ } }
export function readThreadReasoningMode(threadId: string): string { try { return localStorage.getItem(`xiaok:thread-reasoning:${threadId}`) || 'auto' } catch { return 'auto' } }
export function writeThreadReasoningMode(threadId: string, mode: string): void { try { localStorage.setItem(`xiaok:thread-reasoning:${threadId}`, mode) } catch { /* noop */ } }
export function readRunThinkingHint(runId: string): string | null { try { return localStorage.getItem(`xiaok:run-thinking-hint:${runId}`) } catch { return null } }
export function writeRunThinkingHint(runId: string, hint: string): void { try { localStorage.setItem(`xiaok:run-thinking-hint:${runId}`, hint) } catch { /* noop */ } }

// ---- Input drafts ----

export function readInputDraftText(scope: InputDraftScope): string { try { return localStorage.getItem(`xiaok:input-draft:${scope.threadId}`) || '' } catch { return '' } }
export function writeInputDraftText(scope: InputDraftScope, text: string): void { try { localStorage.setItem(`xiaok:input-draft:${scope.threadId}`, text) } catch { /* noop */ } }
export function readInputDraftAttachments(scope: InputDraftScope): DraftAttachmentRecord[] { return readJson(`xiaok:input-draft-attachments:${scope.threadId}`) || [] }
export function writeInputDraftAttachments(scope: InputDraftScope, attachments: DraftAttachmentRecord[]): void { writeJson(`xiaok:input-draft-attachments:${scope.threadId}`, attachments) }
export function readInputHistory(scope: InputDraftScope): string[] { return readJson(`xiaok:input-history:${scope.threadId}`) || [] }
export function appendInputHistory(scope: InputDraftScope, text: string): void {
  const history = readInputHistory(scope).filter(h => h !== text).slice(-19); history.push(text)
  writeJson(`xiaok:input-history:${scope.threadId}`, history)
}
export function clearInputDraft(scope: InputDraftScope): void {
  try { localStorage.removeItem(`xiaok:input-draft:${scope.threadId}`); localStorage.removeItem(`xiaok:input-draft-attachments:${scope.threadId}`) } catch { /* noop */ }
}

// ---- Misc ----

export function migrateMessageMetadata(_mapping: Array<{ old_id: string; new_id: string }>): void { /* noop */ }

export const DEFAULT_PERSONA_KEY = 'normal'
export const SEARCH_PERSONA_KEY = 'extended-search'
export const WORK_PERSONA_KEY = 'work'
export const LEARNING_PERSONA_KEY = 'stem-tutor'

export function readAccessTokenFromStorage(): string | null { return null }
export function writeAccessTokenToStorage(_token: string): void { /* noop */ }
export function clearAccessTokenFromStorage(): void { /* noop */ }

export type UploadedThreadAttachment = { id: string; fileName: string; fileSize: number }
