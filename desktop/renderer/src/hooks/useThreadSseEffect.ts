import { useEffect, useRef, useCallback, type RefObject } from 'react'
import { canonicalToolName, pickLogicalToolName } from '../shared'
import { setThreadTodos } from '../todoDb'
import { useAuth } from '../contexts/auth'
import { useChatSession } from '../contexts/chat-session'
import { useCredits } from '../contexts/credits'
import { useMessageMeta } from '../contexts/message-meta'
import { useMessageStore } from '../contexts/message-store'
import { useRunLifecycle } from '../contexts/run-lifecycle'
import { useStream } from '../contexts/stream'
import { useThreadList } from '../contexts/thread-list'
import { useRunTransition, type TerminalRunCache } from './useRunTransition'
import { SSEApiError } from '../sse'
import {
  applyCodeExecutionToolCall,
  applyCodeExecutionToolResult,
  applyTerminalDelta,
  patchCodeExecutionList,
  findAssistantMessageForRun,
  selectFreshRunEvents,
  applyBrowserToolCall,
  applyBrowserToolResult,
  applySubAgentToolCall,
  applySubAgentToolResult,
  applyFileOpToolCall,
  applyFileOpToolResult,
  applyWebFetchToolCall,
  applyWebFetchToolResult,
  isWebFetchToolName,
  extractArtifacts,
  firstVisibleCodeExecutionToolCallIndex,
} from '../runEventProcessing'
import {
  assistantTurnPlainText,
  foldAssistantTurnEvent,
  requestAssistantTurnThinkingBreak,
} from '../assistantTurnSegments'
import {
  applyRunEventToWebSearchSteps,
  isWebSearchToolName,
  webSearchSourcesFromResult,
} from '../webSearchTimelineFromRunEvent'
import {
  isTerminalRunEventType,
  buildFrozenAssistantTurnFromRunEvents,
  finalizeSearchSteps,
  hasRecoverableRunOutput,
} from '../lib/chat-helpers'
import { extractPartialArtifactFields, extractPartialWidgetFields } from '../components/ArtifactStreamBlock'
import type { MsgRunEvent } from '../storage'
import { getInjectionBlockMessage, shouldSuppressLiveRunEventAfterInjectionBlock } from '../liveRunSecurity'
import type { RequestedSchema } from '../userInputTypes'
import { noteShowWidgetDelta } from '../streamDebug'
import type { MessageResponse } from '../api'

type UseThreadSseEffectDeps = {
  drainQueuedPromptRef: RefObject<(() => void) | null>
  drainForcedQueuedPromptRef: RefObject<((terminal: { runId: string; status: 'completed' | 'cancelled' | 'failed' | 'interrupted' }) => boolean) | null>
}

export function useThreadSseEffect({
  drainQueuedPromptRef,
  drainForcedQueuedPromptRef,
}: UseThreadSseEffectDeps): void {
  const { logout: onLoggedOut } = useAuth()
  const { threadId } = useChatSession()
  const {
    markIdle: onRunEnded,
    updateTitle: onThreadTitleUpdated,
    updateCollaborationMode: onThreadCollaborationModeUpdated,
  } = useThreadList()
  const { refreshCredits } = useCredits()
  const {
    activeRunId,
    setActiveRunId,
    setCancelSubmitting,
    setError,
    setInjectionBlocked,
    injectionBlockedRunIdRef,
    setAwaitingInput,
    setPendingUserInput,
    setCheckInDraft,
    contextCompactBar: _contextCompactBar,
    setContextCompactBar,
    terminalRunDisplayId: _terminalRunDisplayId,
    setTerminalRunDisplayId,
    setTerminalRunHandoffStatus,
    markTerminalRunHistory: markTerminalRunHistoryState,
    completedTitleTailRunId,
    clearCompletedTitleTail: clearCompletedTitleTailState,
    armCompletedTitleTail: armCompletedTitleTailState,
    sse,
    sseRunId,
    processedEventCountRef,
    freezeCutoffRef,
    lastVisibleNonTerminalSeqRef,
    sseTerminalFallbackRunIdRef,
    sseTerminalFallbackArmedRef,
    noResponseMsgIdRef,
    seenFirstToolCallInRunRef,
  } = useRunLifecycle()
  const {
    currentRunSourcesRef,
    currentRunArtifactsRef,
    currentRunCodeExecutionsRef,
    currentRunBrowserActionsRef,
    currentRunSubAgentsRef,
    currentRunFileOpsRef,
    currentRunWebFetchesRef,
    pendingSearchStepsRef,
  } = useMessageMeta()
  const {
    setLiveAssistantTurn,
    setPreserveLiveRunUi,
    assistantTurnFoldStateRef,
    bumpSnapshot: bumpAssistantTurnSnapshot,
    searchStepsRef,
    setSearchSteps,
    resetSearchSteps,
    setStreamingArtifacts,
    streamingArtifactsRef,
    setSegments,
    segmentsRef,
    activeSegmentIdRef,
    appendSegmentContent,
    endSegmentStream,
    addSegment,
    flushSegmentsRefToState,
    setPendingThinking,
    setThinkingHint: _setThinkingHint,
    setTopLevelCodeExecutions,
    setTopLevelSubAgents,
    setTopLevelFileOps,
    setTopLevelWebFetches,
    setWorkTodos,
  } = useStream()
  const {
    refreshMessages,
    upsertLocalTerminalMessage,
  } = useMessageStore()
  const {
    resetAssistantTurnLive,
    clearLiveRunSecurityArtifacts,
    releaseCompletedHandoffToHistory,
    captureTerminalRunCache,
    persistRunDataToMessage,
    persistThreadRunHandoff,
  } = useRunTransition()

  const markTerminalRunHistory = useCallback((messageId: string | null, expanded = true) => {
    markTerminalRunHistoryState(messageId, expanded)
  }, [markTerminalRunHistoryState])
  const clearCompletedTitleTail = useCallback(() => {
    clearCompletedTitleTailState()
  }, [clearCompletedTitleTailState])
  const armCompletedTitleTail = useCallback((runId: string) => {
    armCompletedTitleTailState(runId)
  }, [armCompletedTitleTailState])

  const contextCompactHideTimerRef = useRef<number | null>(null)
  const liveSegmentSnapshotIdsRef = useRef(new Set<string>())
  const drainSseEventsRef = useRef<() => void>(() => {})
  const clearContextCompactHideTimer = useCallback(() => {
    if (contextCompactHideTimerRef.current != null) {
      clearTimeout(contextCompactHideTimerRef.current)
      contextCompactHideTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => { clearContextCompactHideTimer() }
  }, [clearContextCompactHideTimer])

  const scheduleDeferredRunEventDrain = useCallback(() => {
    window.setTimeout(() => {
      drainSseEventsRef.current()
    }, 0)
  }, [])

  useEffect(() => {
    return sse.subscribeEvents(() => {
      drainSseEventsRef.current()
    })
  }, [sse])

  const materializeTerminalRunMessage = useCallback((
    runId: string,
    terminalStatus: 'completed' | 'cancelled' | 'failed' | 'interrupted',
    runCache: TerminalRunCache,
    runEvents: MsgRunEvent[],
  ): MessageResponse | null => {
    if (!threadId) return null
    if (!hasRecoverableRunOutput({
      assistantTurn: runCache.handoffAssistantTurn,
      searchSteps: runCache.pendingSearchSteps,
      widgets: runCache.runWidgets,
      codeExecutions: runCache.runCodeExecs,
      subAgents: runCache.runSubAgents,
      fileOps: runCache.runFileOps,
      webFetches: runCache.runWebFetches,
    })) {
      return null
    }
    const lastEvent = runEvents[runEvents.length - 1]
    const message: MessageResponse = {
      id: `local-terminal-run:${runId}`,
      account_id: '',
      thread_id: threadId,
      created_by_user_id: '',
      role: 'assistant',
      content: assistantTurnPlainText(runCache.handoffAssistantTurn),
      created_at: lastEvent?.ts ?? new Date().toISOString(),
      run_id: runId,
    }
    upsertLocalTerminalMessage(message)
    persistRunDataToMessage(message.id, {
      ...runCache,
      terminalStatus,
    }, runEvents, { clearThreadHandoff: false })
    return message
  }, [persistRunDataToMessage, threadId, upsertLocalTerminalMessage])

  // SSE 事件处理
  const drainSseEvents = () => {
    if (!sseRunId) return
    const resetTerminalRunState = (options?: {
      preserveSearchSteps?: boolean
      handoffRunCache?: TerminalRunCache
    }) => {
      freezeCutoffRef.current = null
      injectionBlockedRunIdRef.current = null
      clearCompletedTitleTail()
      sse.disconnect()
      setActiveRunId(null)
      setCancelSubmitting(false)
      setPendingThinking(false)
      const handoffRunCache = options?.handoffRunCache
      if (handoffRunCache) {
        setPreserveLiveRunUi(true)
        setLiveAssistantTurn(
          handoffRunCache.handoffAssistantTurn.segments.length > 0
            ? handoffRunCache.handoffAssistantTurn
            : null,
        )
      } else {
        setPreserveLiveRunUi(false)
        setLiveAssistantTurn(null)
        setTopLevelCodeExecutions([])
        setTopLevelSubAgents([])
        setTopLevelFileOps([])
        setTopLevelWebFetches([])
      }
      if (!handoffRunCache) {
        liveSegmentSnapshotIdsRef.current.clear()
        streamingArtifactsRef.current = []
        setStreamingArtifacts([])
        flushSegmentsRefToState()
        resetAssistantTurnLive()
        activeSegmentIdRef.current = null
        currentRunSourcesRef.current = []
        currentRunArtifactsRef.current = []
        currentRunCodeExecutionsRef.current = []
        currentRunBrowserActionsRef.current = []
        currentRunSubAgentsRef.current = []
        currentRunFileOpsRef.current = []
        currentRunWebFetchesRef.current = []
      }
      if (!options?.preserveSearchSteps) {
        resetSearchSteps()
      }
      pendingSearchStepsRef.current = null
      setAwaitingInput(false)
      setPendingUserInput(null)
      setCheckInDraft('')
      if (threadId) onRunEnded(threadId)
    }
    const { fresh, nextProcessedCount } = selectFreshRunEvents({
      events: sse.events,
      activeRunId: sseRunId,
      processedCount: processedEventCountRef.current,
    })
    const pauseIndex = firstVisibleCodeExecutionToolCallIndex(fresh)
    const freshToProcess = pauseIndex >= 0 ? fresh.slice(0, pauseIndex + 1) : fresh
    const pausedAt = freshToProcess[freshToProcess.length - 1]
    if (pauseIndex >= 0 && pausedAt) {
      const rawIndex = sse.events.findIndex((event) => event.event_id === pausedAt.event_id)
      processedEventCountRef.current = rawIndex >= 0 ? rawIndex + 1 : nextProcessedCount
      scheduleDeferredRunEventDrain()
    } else {
      processedEventCountRef.current = nextProcessedCount
    }
    for (const event of freshToProcess) {
      const freezeCutoff = freezeCutoffRef.current
      if (
        freezeCutoff != null &&
        typeof event.seq === 'number' &&
        event.seq > freezeCutoff &&
        !isTerminalRunEventType(event.type)
      ) {
        continue
      }
      if (shouldSuppressLiveRunEventAfterInjectionBlock({
        activeRunId,
        blockedRunId: injectionBlockedRunIdRef.current,
        event,
      })) {
        continue
      }
      const nextWebSearchSteps = applyRunEventToWebSearchSteps(searchStepsRef.current, event)
      if (nextWebSearchSteps !== searchStepsRef.current) {
        searchStepsRef.current = nextWebSearchSteps
        setSearchSteps(nextWebSearchSteps)
      }

      if (event.type === 'run.segment.start') {
        const obj = event.data as { segment_id?: unknown; kind?: unknown; display?: unknown }
        const segmentId = typeof obj.segment_id === 'string' ? obj.segment_id : ''
        const kind = typeof obj.kind === 'string' ? obj.kind : 'planning_round'
        const display = (obj.display ?? {}) as { mode?: unknown; label?: unknown; queries?: unknown }
        const mode = typeof display.mode === 'string' ? display.mode : 'collapsed'
        const label = typeof display.label === 'string' ? display.label : ''
        if (!segmentId) continue
        activeSegmentIdRef.current = segmentId
        liveSegmentSnapshotIdsRef.current.delete(segmentId)
        requestAssistantTurnThinkingBreak(assistantTurnFoldStateRef.current)
        foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
        bumpAssistantTurnSnapshot()
        if (kind.startsWith('search_')) {
          continue
        }
        addSegment({ segmentId, kind, mode, label, content: '', isStreaming: true, codeExecutions: [] })
        continue
      }

      if (event.type === 'run.context_compact') {
        const obj = event.data as { phase?: unknown; op?: unknown; dropped_prefix?: unknown }
        const op = typeof obj.op === 'string' ? obj.op : undefined
        const phase = typeof obj.phase === 'string' ? obj.phase : undefined

        if (op === 'persist') {
          if (phase === 'started') {
            clearContextCompactHideTimer()
            setContextCompactBar({ type: 'persist', status: 'running' })
          } else if (phase === 'completed' || phase === undefined) {
            clearContextCompactHideTimer()
            setContextCompactBar({ type: 'persist', status: 'done' })
            contextCompactHideTimerRef.current = window.setTimeout(() => {
              setContextCompactBar(null)
              contextCompactHideTimerRef.current = null
            }, 2800)
          } else if (phase === 'llm_failed') {
            clearContextCompactHideTimer()
            setContextCompactBar({ type: 'persist', status: 'llm_failed' })
            contextCompactHideTimerRef.current = window.setTimeout(() => {
              setContextCompactBar(null)
              contextCompactHideTimerRef.current = null
            }, 4000)
          }
        } else if (op === 'trim') {
          if (phase === 'completed') {
            const dropped = typeof obj.dropped_prefix === 'number' ? obj.dropped_prefix : 0
            if (dropped > 0) {
              clearContextCompactHideTimer()
              setContextCompactBar({ type: 'trim', status: 'done', dropped })
              contextCompactHideTimerRef.current = window.setTimeout(() => {
                setContextCompactBar(null)
                contextCompactHideTimerRef.current = null
              }, 1500)
            }
          }
        }
        continue
      }

      if (event.type === 'todo.updated') {
        const obj = event.data as { todos?: unknown }
        if (Array.isArray(obj.todos)) {
          const items = (obj.todos as unknown[]).flatMap((t) => {
            if (!t || typeof t !== 'object') return []
            const item = t as { id?: unknown; content?: unknown; status?: unknown }
            if (typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.status !== 'string') return []
            const activeForm = typeof (t as { active_form?: unknown }).active_form === 'string'
              ? (t as { active_form: string }).active_form.trim()
              : ''
            return [{ id: item.id, content: item.content, ...(activeForm ? { activeForm } : {}), status: item.status }]
          })
          setWorkTodos(items)
          if (threadId) setThreadTodos(threadId, items).catch(() => {})
        }
        continue
      }

      if (event.type === 'run.segment.end') {
        const obj = event.data as { segment_id?: unknown }
        const segmentId = typeof obj.segment_id === 'string' ? obj.segment_id : ''
        if (segmentId && activeSegmentIdRef.current === segmentId) {
          activeSegmentIdRef.current = null
        }
        requestAssistantTurnThinkingBreak(assistantTurnFoldStateRef.current)
        foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
        bumpAssistantTurnSnapshot()
        endSegmentStream(segmentId)
        continue
      }

      if (event.type === 'message.delta') {
        noResponseMsgIdRef.current = null
        const obj = event.data as { content_delta?: unknown; role?: unknown; channel?: unknown }
        if (obj.role != null && obj.role !== 'assistant') continue
        if (typeof obj.content_delta !== 'string' || !obj.content_delta) continue
        const delta = obj.content_delta
        const channel = typeof obj.channel === 'string' ? obj.channel : ''
        const isThinking = channel === 'thinking'
        const eventSeq = typeof event.seq === 'number' ? event.seq : 0
        if (!isThinking && channel.trim() === '') {
          if (eventSeq > lastVisibleNonTerminalSeqRef.current) {
            lastVisibleNonTerminalSeqRef.current = eventSeq
          }
        }
        const activeSeg = activeSegmentIdRef.current
        if (isThinking) {
          setPendingThinking(false)
          foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
          bumpAssistantTurnSnapshot()
          continue
        }
        setPendingThinking(false)
        if (activeSeg) {
          const activeSegment = segmentsRef.current.find((segment) => segment.segmentId === activeSeg)
          const activeSegmentVisible = !!activeSegment && activeSegment.mode !== 'hidden'
          requestAssistantTurnThinkingBreak(assistantTurnFoldStateRef.current)
          appendSegmentContent(activeSeg, delta)
          if (activeSegmentVisible) {
            foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
            if (!liveSegmentSnapshotIdsRef.current.has(activeSeg)) {
              liveSegmentSnapshotIdsRef.current.add(activeSeg)
              bumpAssistantTurnSnapshot()
            }
          }
          continue
        }
        foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
        bumpAssistantTurnSnapshot()
        continue
      }

      if (event.type === 'tool.call.delta') {
        const obj = event.data as { tool_call_index?: number; tool_call_id?: string; tool_name?: string; arguments_delta?: string }
        const idx = typeof obj.tool_call_index === 'number' ? obj.tool_call_index : -1
        if (idx >= 0 && typeof obj.arguments_delta === 'string') {
          let entry = streamingArtifactsRef.current.find((e) => e.toolCallIndex === idx)
          if (!entry) {
            entry = { toolCallIndex: idx, argumentsBuffer: '', complete: false }
            streamingArtifactsRef.current = [...streamingArtifactsRef.current, entry]
          }
          if (obj.tool_call_id) entry.toolCallId = obj.tool_call_id
          if (obj.tool_name) entry.toolName = canonicalToolName(obj.tool_name)
          entry.argumentsBuffer += obj.arguments_delta
          const isShowWidgetDelta = entry.toolName === 'show_widget' || canonicalToolName(obj.tool_name ?? '') === 'show_widget'

          if (entry.toolName === 'show_widget' || (!entry.toolName && entry.argumentsBuffer.includes('"widget_code"'))) {
            const parsed = extractPartialWidgetFields(entry.argumentsBuffer)
            if (parsed.title !== undefined) entry.title = parsed.title
            if (parsed.widgetCode !== undefined) entry.content = parsed.widgetCode
            if (parsed.loadingMessages !== undefined) entry.loadingMessages = parsed.loadingMessages
            setStreamingArtifacts([...streamingArtifactsRef.current])
            if (isShowWidgetDelta) {
              noteShowWidgetDelta({
                runId: sseRunId,
                toolCallId: entry.toolCallId,
                toolCallIndex: entry.toolCallIndex,
                title: entry.title ?? null,
                contentLength: entry.content?.length ?? 0,
                seq: event.seq,
              })
            }
          } else if (entry.toolName === 'create_artifact' || (!entry.toolName && entry.argumentsBuffer.includes('"content"'))) {
            const parsed = extractPartialArtifactFields(entry.argumentsBuffer)
            if (parsed.title !== undefined) entry.title = parsed.title
            if (parsed.filename !== undefined) entry.filename = parsed.filename
            if (parsed.display !== undefined) entry.display = parsed.display as 'inline' | 'panel'
            if (parsed.content !== undefined) entry.content = parsed.content
            if (parsed.loadingMessages !== undefined) entry.loadingMessages = parsed.loadingMessages
            setStreamingArtifacts([...streamingArtifactsRef.current])
          }
        }
        continue
      }

      if (event.type === 'tool.call') {
        setPendingThinking(false)
        seenFirstToolCallInRunRef.current = true
        const obj = event.data as { llm_name?: unknown; tool_call_id?: unknown; arguments?: unknown }
        const toolName = pickLogicalToolName(event.data, event.tool_name)
        const codeExecutionCall = applyCodeExecutionToolCall(currentRunCodeExecutionsRef.current, event)
        if (codeExecutionCall.appended) {
          const entry = codeExecutionCall.appended
          currentRunCodeExecutionsRef.current = codeExecutionCall.nextExecutions
          const activeSeg = activeSegmentIdRef.current
          if (activeSeg) {
            setSegments((prev) =>
              prev.map((s) =>
                s.segmentId === activeSeg
                  ? { ...s, codeExecutions: [...s.codeExecutions, entry] }
                  : s,
              ),
            )
          }
          setTopLevelCodeExecutions((prev) => [...prev, entry])
        }
        const browserCall = applyBrowserToolCall(currentRunBrowserActionsRef.current, event)
        if (browserCall.appended) {
          currentRunBrowserActionsRef.current = browserCall.nextActions
        }
        const subAgentCall = applySubAgentToolCall(currentRunSubAgentsRef.current, event)
        if (subAgentCall.appended) {
          currentRunSubAgentsRef.current = subAgentCall.nextAgents
          setTopLevelSubAgents((prev) => [...prev, subAgentCall.appended!])
        }
        const fileOpCall = applyFileOpToolCall(currentRunFileOpsRef.current, event)
        if (fileOpCall.appended) {
          currentRunFileOpsRef.current = fileOpCall.nextOps
          setTopLevelFileOps((prev) => [...prev, fileOpCall.appended!])
        }
        const webFetchCall = applyWebFetchToolCall(currentRunWebFetchesRef.current, event)
        if (webFetchCall.appended) {
          currentRunWebFetchesRef.current = webFetchCall.nextFetches
          setTopLevelWebFetches((prev) => [...prev, webFetchCall.appended!])
        }
        if (toolName === 'show_widget') {
          const args = obj.arguments as Record<string, unknown> | undefined
          const callId = typeof obj.tool_call_id === 'string' ? obj.tool_call_id : undefined
          let entry = callId
            ? streamingArtifactsRef.current.find((e) => e.toolCallId === callId)
            : undefined
          if (!entry) {
            entry = {
              toolCallIndex: streamingArtifactsRef.current.length,
              toolCallId: callId,
              toolName: 'show_widget',
              argumentsBuffer: '',
              complete: false,
            }
            streamingArtifactsRef.current = [...streamingArtifactsRef.current, entry]
          }
          entry.complete = true
          entry.toolName = 'show_widget'
          if (typeof args?.widget_code === 'string') entry.content = args.widget_code
          if (typeof args?.title === 'string') entry.title = args.title
          if (Array.isArray(args?.loading_messages)) {
            const messages = (args?.loading_messages as unknown[])
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.trim())
              .filter((x) => x.length > 0)
            if (messages.length > 0) entry.loadingMessages = messages
          }
          setStreamingArtifacts([...streamingArtifactsRef.current])
        }
        if (toolName === 'create_artifact') {
          const args = obj.arguments as Record<string, unknown> | undefined
          const callId = typeof obj.tool_call_id === 'string' ? obj.tool_call_id : undefined
          let entry = callId
            ? streamingArtifactsRef.current.find((e) => e.toolCallId === callId)
            : undefined
          if (!entry) {
            entry = {
              toolCallIndex: streamingArtifactsRef.current.length,
              toolCallId: callId,
              toolName: 'create_artifact',
              argumentsBuffer: '',
              complete: false,
            }
            streamingArtifactsRef.current = [...streamingArtifactsRef.current, entry]
          }
          entry.complete = true
          entry.toolName = 'create_artifact'
          if (typeof args?.content === 'string') entry.content = args.content
          if (typeof args?.title === 'string') entry.title = args.title
          if (typeof args?.filename === 'string') entry.filename = args.filename
          if (typeof args?.display === 'string') entry.display = args.display as 'inline' | 'panel'
          if (Array.isArray(args?.loading_messages)) {
            const messages = (args?.loading_messages as unknown[])
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.trim())
              .filter((x) => x.length > 0)
            if (messages.length > 0) entry.loadingMessages = messages
          }
          setStreamingArtifacts([...streamingArtifactsRef.current])
        }
        foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
        bumpAssistantTurnSnapshot()
        continue
      }

      if (event.type === 'terminal.stdout_delta' || event.type === 'terminal.stderr_delta') {
        const deltaPatch = applyTerminalDelta(currentRunCodeExecutionsRef.current, event)
        if (deltaPatch.updated) {
          currentRunCodeExecutionsRef.current = deltaPatch.nextExecutions
          setTopLevelCodeExecutions((prev) => patchCodeExecutionList(prev, deltaPatch.updated!).next)
          setSegments((prev) =>
            prev.map((segment) => ({
              ...segment,
              codeExecutions: patchCodeExecutionList(segment.codeExecutions, deltaPatch.updated!).next,
            })),
          )
        }
        continue
      }

      if (event.type === 'tool.result') {
        const obj = event.data as { tool_call_id?: unknown; result?: unknown; error?: unknown }
        const resultToolName = pickLogicalToolName(event.data, event.tool_name)
        if (isWebSearchToolName(resultToolName)) {
          const newSources = webSearchSourcesFromResult(obj.result)
          if (newSources && newSources.length > 0) {
            currentRunSourcesRef.current = [...currentRunSourcesRef.current, ...newSources]
          }
        }
        const result = obj.result as { artifacts?: unknown[]; stdout?: unknown; stderr?: unknown; exit_code?: unknown; output?: unknown } | undefined
        const newArtifacts = extractArtifacts(result)
        if (newArtifacts.length > 0) {
          currentRunArtifactsRef.current = [...currentRunArtifactsRef.current, ...newArtifacts]
          if (resultToolName === 'create_artifact') {
            const callId = typeof obj.tool_call_id === 'string' ? obj.tool_call_id : undefined
            for (const art of newArtifacts) {
              const entry = callId
                ? streamingArtifactsRef.current.find((e) => e.toolCallId === callId)
                : undefined
              if (entry) {
                entry.artifactRef = art
              }
            }
            setStreamingArtifacts([...streamingArtifactsRef.current])
          }
        }
        if (resultToolName === 'python_execute' || resultToolName === 'exec_command' || resultToolName === 'continue_process' || resultToolName === 'terminate_process' || resultToolName === 'document_write' || resultToolName === 'create_artifact' || resultToolName === 'browser' || isWebFetchToolName(resultToolName)) {
          const codeExecutionResult = applyCodeExecutionToolResult(currentRunCodeExecutionsRef.current, event)
          if (codeExecutionResult.updated) {
            currentRunCodeExecutionsRef.current = codeExecutionResult.nextExecutions
            const target = codeExecutionResult.updated
            if (codeExecutionResult.appended) {
              setTopLevelCodeExecutions((prev) => [...prev, target])
            } else {
              setTopLevelCodeExecutions((prev) => patchCodeExecutionList(prev, target).next)
              setSegments((prev) =>
                prev.map((segment) => ({
                  ...segment,
                  codeExecutions: patchCodeExecutionList(segment.codeExecutions, target).next,
                })),
              )
            }
          }
        }
        if (resultToolName === 'browser') {
          const browserResult = applyBrowserToolResult(currentRunBrowserActionsRef.current, event)
          if (browserResult.updated) {
            currentRunBrowserActionsRef.current = browserResult.nextActions
          }
        }
        const subAgentResult = applySubAgentToolResult(currentRunSubAgentsRef.current, event)
        if (subAgentResult.updated) {
          currentRunSubAgentsRef.current = subAgentResult.nextAgents
          setTopLevelSubAgents((prev) => {
            const idx = prev.findIndex((a) => a.id === subAgentResult.updated!.id)
            if (idx >= 0) return prev.map((a, i) => i === idx ? subAgentResult.updated! : a)
            return [...prev, subAgentResult.updated!]
          })
        }
        const fileOpResult = applyFileOpToolResult(currentRunFileOpsRef.current, event)
        if (fileOpResult.updated) {
          currentRunFileOpsRef.current = fileOpResult.nextOps
          setTopLevelFileOps((prev) => {
            const idx = prev.findIndex((o) => o.id === fileOpResult.updated!.id)
            if (idx >= 0) return prev.map((o, i) => i === idx ? fileOpResult.updated! : o)
            return [...prev, fileOpResult.updated!]
          })
        }
        const webFetchResult = applyWebFetchToolResult(currentRunWebFetchesRef.current, event)
        if (webFetchResult.updated) {
          currentRunWebFetchesRef.current = webFetchResult.nextFetches
          setTopLevelWebFetches((prev) => {
            const idx = prev.findIndex((f) => f.id === webFetchResult.updated!.id)
            if (idx >= 0) return prev.map((f, i) => i === idx ? webFetchResult.updated! : f)
            return [...prev, webFetchResult.updated!]
          })
        }
        foldAssistantTurnEvent(assistantTurnFoldStateRef.current, event)
        bumpAssistantTurnSnapshot()
        continue
      }

      if (event.type === 'thread.title.updated') {
        const obj = event.data as { thread_id?: unknown; title?: unknown }
        const tid = typeof obj.thread_id === 'string' ? obj.thread_id : threadId
        const title = typeof obj.title === 'string' ? obj.title : ''
        if (tid && title) onThreadTitleUpdated(tid, title)
        if (event.run_id && event.run_id === completedTitleTailRunId) {
          clearCompletedTitleTail()
        }
        continue
      }

      if (event.type === 'thread.collaboration_mode.updated') {
        const obj = event.data as { thread_id?: unknown; collaboration_mode?: unknown; collaboration_mode_revision?: unknown }
        const tid = typeof obj.thread_id === 'string' ? obj.thread_id : threadId
        const collaborationMode = obj.collaboration_mode === 'plan' ? 'plan' : obj.collaboration_mode === 'default' ? 'default' : null
        const revision = typeof obj.collaboration_mode_revision === 'number' ? obj.collaboration_mode_revision : undefined
        if (tid && collaborationMode) {
          onThreadCollaborationModeUpdated(tid, collaborationMode, revision)
        }
        continue
      }

      if (event.type === 'run.input_requested') {
        // SSE 重连时会重放历史事件，只有 run 实际继续执行的事件才能证明 input 已被回答
        const hasRunContinued = sse.events.some(
          (e) => e.run_id === event.run_id && e.seq > event.seq
            && (e.type === 'tool.result' || isTerminalRunEventType(e.type)),
        )
        if (hasRunContinued) continue

        const data = event.data as Record<string, unknown> | undefined
        const message = data?.message as string | undefined
        const schema = data?.requestedSchema as RequestedSchema | undefined
        if (message && schema && schema.properties && Object.keys(schema.properties).length > 0) {
          const safeSchema: RequestedSchema = {
            ...schema,
            required: Array.isArray(schema.required) ? schema.required : undefined,
          }
          setPendingUserInput({
            request_id: (data?.request_id as string) ?? '',
            message,
            requestedSchema: safeSchema,
          })
        } else {
          setAwaitingInput(true)
        }
        continue
      }

      if (event.type === 'security.injection.blocked') {
        freezeCutoffRef.current = null
        injectionBlockedRunIdRef.current = event.run_id
        sseTerminalFallbackArmedRef.current = false
        sseTerminalFallbackRunIdRef.current = null
        sse.disconnect()
        setActiveRunId(null)
        setCancelSubmitting(false)
        setError(null)
        clearLiveRunSecurityArtifacts()
        setInjectionBlocked(getInjectionBlockMessage(event))
        if (threadId) onRunEnded(threadId)
        continue
      }

      if (event.type === 'run.completed') {
        freezeCutoffRef.current = null
        const completedRunId = event.run_id
        injectionBlockedRunIdRef.current = null
        noResponseMsgIdRef.current = null
        setPreserveLiveRunUi(true)
        setTerminalRunDisplayId(completedRunId)
        setTerminalRunHandoffStatus('completed')
        const runEventsForMessage = (sse.events as MsgRunEvent[]).filter((e) => {
          if (e.run_id !== completedRunId || typeof e.seq !== 'number') {
            return false
          }
          return e.seq <= event.seq
        })
        const runCache = captureTerminalRunCache('completed')
        if (runEventsForMessage.length > 0) {
          const frozenAssistantTurn = buildFrozenAssistantTurnFromRunEvents(runEventsForMessage)
          if (frozenAssistantTurn.segments.length > 0) {
            runCache.handoffAssistantTurn = frozenAssistantTurn
            runCache.runAssistantTurn = frozenAssistantTurn
          }
        }
        setLiveAssistantTurn(runCache.handoffAssistantTurn.segments.length > 0 ? runCache.handoffAssistantTurn : null)
        armCompletedTitleTail(completedRunId)
        setActiveRunId(null)
        setCancelSubmitting(false)
        setPendingThinking(false)
        flushSegmentsRefToState()

        const runSearchSteps = finalizeSearchSteps(searchStepsRef.current)
        if (runSearchSteps.length > 0) {
          pendingSearchStepsRef.current = runSearchSteps
        }
        const completedRunCache = {
          ...runCache,
          pendingSearchSteps: runSearchSteps.length > 0 ? runSearchSteps : runCache.pendingSearchSteps,
        }
        const completedHasRecoverableOutput = hasRecoverableRunOutput({
          assistantTurn: completedRunCache.handoffAssistantTurn,
          searchSteps: completedRunCache.pendingSearchSteps,
          widgets: completedRunCache.runWidgets,
          codeExecutions: completedRunCache.runCodeExecs,
          subAgents: completedRunCache.runSubAgents,
          fileOps: completedRunCache.runFileOps,
          webFetches: completedRunCache.runWebFetches,
        })
        const localCompletedAssistant = completedHasRecoverableOutput
          ? materializeTerminalRunMessage(completedRunId, 'completed', completedRunCache, runEventsForMessage)
          : null
        if (completedHasRecoverableOutput) {
          persistThreadRunHandoff(completedRunId, completedRunCache)
        }
        if (localCompletedAssistant) {
          releaseCompletedHandoffToHistory()
        }
        setAwaitingInput(false)
        setPendingUserInput(null)
        setCheckInDraft('')
        if (threadId) onRunEnded(threadId)
        refreshCredits()
        void refreshMessages({ requiredCompletedRunId: completedHasRecoverableOutput ? completedRunId : undefined })
          .then((items) => {
            const completedAssistant = findAssistantMessageForRun(items, completedRunId)
            if (completedAssistant) {
              const pendingSteps = pendingSearchStepsRef.current
              pendingSearchStepsRef.current = null
              persistRunDataToMessage(completedAssistant.id, {
                ...completedRunCache,
                pendingSearchSteps: pendingSteps,
              }, runEventsForMessage)
              markTerminalRunHistory(completedAssistant.id, false)
              releaseCompletedHandoffToHistory()
            }
            if (completedAssistant || localCompletedAssistant || !completedHasRecoverableOutput) {
              if (!drainForcedQueuedPromptRef.current?.({ runId: completedRunId, status: 'completed' })) {
                drainQueuedPromptRef.current?.()
              }
            }
          })
          .catch((err) => console.error('persist run data failed', err))
        continue
      }

      if (event.type === 'run.cancelled') {
        const blockedByInjection = injectionBlockedRunIdRef.current === event.run_id
        const runId = event.run_id
        setTerminalRunDisplayId(runId)
        setTerminalRunHandoffStatus('cancelled')
        const runSearchSteps = finalizeSearchSteps(searchStepsRef.current)
        if (runSearchSteps.length > 0) {
          pendingSearchStepsRef.current = runSearchSteps
        }
        const runEventsForMessage = runId
          ? (sse.events as MsgRunEvent[]).filter((e) => {
            if (e.run_id !== runId || typeof e.seq !== 'number') {
              return false
            }
            return e.seq <= event.seq
          })
          : []
        const runCache = captureTerminalRunCache('cancelled')
        if (runCache.handoffAssistantTurn.segments.length === 0 && runEventsForMessage.length > 0) {
          runCache.handoffAssistantTurn = buildFrozenAssistantTurnFromRunEvents(runEventsForMessage)
          runCache.runAssistantTurn = runCache.handoffAssistantTurn
        }
        if (runId) {
          persistThreadRunHandoff(runId, runCache)
        }
        const runHasRecoverableOutput = hasRecoverableRunOutput({
          assistantTurn: runCache.handoffAssistantTurn,
          searchSteps: runSearchSteps.length > 0 ? runSearchSteps : runCache.pendingSearchSteps,
          widgets: runCache.runWidgets,
          codeExecutions: runCache.runCodeExecs,
          subAgents: runCache.runSubAgents,
          fileOps: runCache.runFileOps,
          webFetches: runCache.runWebFetches,
        })
        const localAssistant = runHasRecoverableOutput
          ? materializeTerminalRunMessage(runId, 'cancelled', runCache, runEventsForMessage)
          : null
        resetTerminalRunState({
          preserveSearchSteps: true,
          handoffRunCache: runHasRecoverableOutput && !localAssistant ? runCache : undefined,
        })
        if (!blockedByInjection) {
          setError(null)
        }
        if (runId) {
          void refreshMessages({ requiredCompletedRunId: runHasRecoverableOutput ? runId : undefined })
            .then((items) => {
              const assistant = findAssistantMessageForRun(items, runId)
              if (assistant) {
                persistRunDataToMessage(assistant.id, runCache, runEventsForMessage)
                markTerminalRunHistory(assistant.id, false)
              }
              if (assistant || localAssistant || !runHasRecoverableOutput) {
                drainForcedQueuedPromptRef.current?.({ runId, status: 'cancelled' })
              }
            })
            .catch((err) => console.error('persist run data failed', err))
        }
        continue
      }

      if (event.type === 'run.failed') {
        const runId = event.run_id
        setTerminalRunDisplayId(runId)
        setTerminalRunHandoffStatus('failed')
        const runEventsForMessage = runId
          ? (sse.events as MsgRunEvent[]).filter((e) => {
            if (e.run_id !== runId || typeof e.seq !== 'number') {
              return false
            }
            return e.seq <= event.seq
          })
          : []
        const runCache = captureTerminalRunCache('failed')
        if (runCache.handoffAssistantTurn.segments.length === 0 && runEventsForMessage.length > 0) {
          runCache.handoffAssistantTurn = buildFrozenAssistantTurnFromRunEvents(runEventsForMessage)
          runCache.runAssistantTurn = runCache.handoffAssistantTurn
        }
        if (runId) {
          persistThreadRunHandoff(runId, runCache)
        }
        const runHasRecoverableOutput = hasRecoverableRunOutput({
          assistantTurn: runCache.handoffAssistantTurn,
          searchSteps: runCache.pendingSearchSteps,
          widgets: runCache.runWidgets,
          codeExecutions: runCache.runCodeExecs,
          subAgents: runCache.runSubAgents,
          fileOps: runCache.runFileOps,
          webFetches: runCache.runWebFetches,
        })
        const localAssistant = runHasRecoverableOutput
          ? materializeTerminalRunMessage(runId, 'failed', runCache, runEventsForMessage)
          : null
        resetTerminalRunState({
          preserveSearchSteps: true,
          handoffRunCache: runHasRecoverableOutput && !localAssistant ? runCache : undefined,
        })
        const obj = event.data as { message?: unknown; error_class?: unknown; code?: unknown; details?: unknown }
        const errorClass = typeof obj?.error_class === 'string' ? obj.error_class : undefined
        const details = (obj?.details && typeof obj.details === 'object' && !Array.isArray(obj.details))
          ? obj.details as Record<string, unknown>
          : undefined

        if (errorClass === 'security.injection_blocked') {
          setInjectionBlocked(typeof obj?.message === 'string' ? obj.message : 'blocked')
        } else {
          setError({
            message: typeof obj?.message === 'string' ? obj.message : '运行失败',
            code: typeof obj?.code === 'string' ? obj.code : errorClass,
            details,
          })
        }
        if (runId) {
          void refreshMessages({ requiredCompletedRunId: runHasRecoverableOutput ? runId : undefined })
            .then((items) => {
              const assistant = findAssistantMessageForRun(items, runId)
              if (assistant) {
                persistRunDataToMessage(assistant.id, runCache, runEventsForMessage)
              }
              if (assistant || localAssistant || !runHasRecoverableOutput) {
                drainForcedQueuedPromptRef.current?.({ runId, status: 'failed' })
              }
            })
            .catch((err) => console.error('persist run data failed', err))
        }
        continue
      }

      if (event.type === 'run.interrupted') {
        const runId = event.run_id
        setTerminalRunDisplayId(runId)
        setTerminalRunHandoffStatus('interrupted')
        const runEventsForMessage = runId
          ? (sse.events as MsgRunEvent[]).filter((e) => {
            if (e.run_id !== runId || typeof e.seq !== 'number') {
              return false
            }
            return e.seq <= event.seq
          })
          : []
        const runCache = captureTerminalRunCache('interrupted')
        if (runCache.handoffAssistantTurn.segments.length === 0 && runEventsForMessage.length > 0) {
          runCache.handoffAssistantTurn = buildFrozenAssistantTurnFromRunEvents(runEventsForMessage)
          runCache.runAssistantTurn = runCache.handoffAssistantTurn
        }
        if (runId) {
          persistThreadRunHandoff(runId, runCache)
        }
        const runHasRecoverableOutput = hasRecoverableRunOutput({
          assistantTurn: runCache.handoffAssistantTurn,
          searchSteps: runCache.pendingSearchSteps,
          widgets: runCache.runWidgets,
          codeExecutions: runCache.runCodeExecs,
          subAgents: runCache.runSubAgents,
          fileOps: runCache.runFileOps,
          webFetches: runCache.runWebFetches,
        })
        const localAssistant = runHasRecoverableOutput
          ? materializeTerminalRunMessage(runId, 'interrupted', runCache, runEventsForMessage)
          : null
        resetTerminalRunState({
          preserveSearchSteps: true,
          handoffRunCache: runHasRecoverableOutput && !localAssistant ? runCache : undefined,
        })
        const obj = event.data as { message?: unknown; error_class?: unknown; code?: unknown; details?: unknown }
        const errorClass = typeof obj?.error_class === 'string' ? obj.error_class : undefined
        const details = (obj?.details && typeof obj.details === 'object' && !Array.isArray(obj.details))
          ? obj.details as Record<string, unknown>
          : undefined

        setError({
          message: typeof obj?.message === 'string' ? obj.message : '运行中断',
          code: typeof obj?.code === 'string' ? obj.code : errorClass,
          details,
        })
        if (event.run_id) {
          void refreshMessages({ requiredCompletedRunId: runHasRecoverableOutput ? runId! : undefined })
            .then((items) => {
              const assistant = findAssistantMessageForRun(items, runId!)
              if (assistant) {
                persistRunDataToMessage(assistant.id, runCache, runEventsForMessage)
              }
              if (assistant || localAssistant || !runHasRecoverableOutput) {
                drainForcedQueuedPromptRef.current?.({ runId: runId!, status: 'interrupted' })
              }
            })
            .catch((err) => console.error('persist run data failed', err))
        }
        continue
      }
    }
  }

  useEffect(() => {
    drainSseEventsRef.current = drainSseEvents
    drainSseEvents()
  })

  // 401 SSE 错误时登出
  useEffect(() => {
    if (sse.error instanceof SSEApiError && sse.error.status === 401) {
      onLoggedOut()
    }
  }, [sse.error, onLoggedOut])

  // SSE fallback 清理
  useEffect(() => {
    if (!activeRunId) return
    if (sse.state !== 'closed' && sse.state !== 'error') return
    if (!sseTerminalFallbackArmedRef.current) return
    if (sseTerminalFallbackRunIdRef.current !== activeRunId) return
    const terminalRunId = activeRunId

    sseTerminalFallbackArmedRef.current = false
    sseTerminalFallbackRunIdRef.current = null
    const terminalRunMaxSeq = (sse.events as MsgRunEvent[])
      .filter((e) => e.run_id === terminalRunId && typeof e.seq === 'number')
      .reduce((max, e) => Math.max(max, e.seq), 0)
    const runEventsForMessage = (sse.events as MsgRunEvent[]).filter((e) =>
      e.run_id === terminalRunId &&
      typeof e.seq === 'number' &&
      e.seq <= terminalRunMaxSeq,
    )
    const terminalCache = captureTerminalRunCache()
    if (terminalCache.handoffAssistantTurn.segments.length === 0 && runEventsForMessage.length > 0) {
      terminalCache.handoffAssistantTurn = buildFrozenAssistantTurnFromRunEvents(runEventsForMessage)
      terminalCache.runAssistantTurn = terminalCache.handoffAssistantTurn
    }
    setTerminalRunDisplayId(terminalRunId)
    setPreserveLiveRunUi(true)
    setTerminalRunHandoffStatus('interrupted')
    setLiveAssistantTurn(terminalCache.handoffAssistantTurn.segments.length > 0 ? terminalCache.handoffAssistantTurn : null)
    persistThreadRunHandoff(terminalRunId, {
      ...terminalCache,
      terminalStatus: 'interrupted',
    })

    setActiveRunId(null)
    setPendingThinking(false)
    setAwaitingInput(false)
    setPendingUserInput(null)
    setCheckInDraft('')
    if (threadId) onRunEnded(threadId)
    refreshCredits()

    void refreshMessages({ requiredCompletedRunId: terminalRunId })
      .then((items) => {
        const completedAssistant = findAssistantMessageForRun(items, terminalRunId)
        if (completedAssistant) {
          persistRunDataToMessage(completedAssistant.id, terminalCache, runEventsForMessage)
        }
      })
      .catch((err) => console.error('persist run data failed', err))
  }, [activeRunId, sse.state, persistRunDataToMessage, persistThreadRunHandoff]) // eslint-disable-line react-hooks/exhaustive-deps
}
