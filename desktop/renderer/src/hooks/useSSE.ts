import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { silentRefresh } from '@arkloop/shared'
import { isLocalMode } from '@arkloop/shared/desktop'
import { createSSEClient, type RunEvent, type SSEClient, type SSEClientState } from '../sse'
import { clearLastSeqInStorage, readLastSeqFromStorage, writeLastSeqToStorage } from '../storage'
import { emitStreamDebug } from '../streamDebug'

export type UseSSEOptions = {
  runId: string
  accessToken: string
  baseUrl?: string
}

export type UseSSEResult = {
  events: RunEvent[]
  state: SSEClientState
  lastSeq: number
  error: Error | null
  subscribeEvents: (listener: () => void) => () => void
  connect: () => void
  disconnect: () => void
  reconnect: () => void
  clearEvents: () => void
  reset: () => void
}

/**
 * SSE 订阅 Hook
 * 管理 run 事件流的订阅与状态
 */
export function useSSE(options: UseSSEOptions): UseSSEResult {
  const { runId, accessToken, baseUrl = '' } = options

  const [state, setState] = useState<SSEClientState>('idle')
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<SSEClient | null>(null)
  const eventsRef = useRef<RunEvent[]>([])
  const eventListenersRef = useRef(new Set<() => void>())
  const seenSeqsRef = useRef<Set<number>>(new Set())
  const cursorRef = useRef(0)
  const connectedRunIdRef = useRef('')
  const lastStorageWriteRef = useRef(0)
  const storageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 构建 SSE URL
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const sseUrl = `${normalizedBaseUrl}/v1/runs/${runId}/events`

  const notifyEventListeners = useCallback(() => {
    for (const listener of eventListenersRef.current) {
      listener()
    }
  }, [])

  const handleEvent = useCallback((event: RunEvent) => {
    // 去重：避免重连时重复展示
    if (seenSeqsRef.current.has(event.seq)) return
    seenSeqsRef.current.add(event.seq)

    eventsRef.current.push(event)

    if (typeof event.seq === 'number' && event.seq >= 0) {
      cursorRef.current = event.seq

      // 限频写入：避免 streaming/catch-up 时每条事件都写一次 localStorage
      const now = Date.now()
      if (now - lastStorageWriteRef.current > 1000) {
        lastStorageWriteRef.current = now
        writeLastSeqToStorage(runId, event.seq)
        if (storageTimerRef.current) {
          clearTimeout(storageTimerRef.current)
          storageTimerRef.current = null
        }
      } else if (!storageTimerRef.current) {
        storageTimerRef.current = setTimeout(() => {
          storageTimerRef.current = null
          lastStorageWriteRef.current = Date.now()
          writeLastSeqToStorage(runId, cursorRef.current)
        }, 1000)
      }
    }
    notifyEventListeners()
  }, [notifyEventListeners, runId])

  const handleStateChange = useCallback((newState: SSEClientState) => {
    setState(newState)
    emitStreamDebug('run-sse:state', {
      runId,
      state: newState,
      lastSeq: cursorRef.current,
    }, 'run-sse')
    // 重连成功后清除之前的网络错误，避免瞬时错误持续显示
    if (newState === 'connected') {
      setError(null)
    }
  }, [runId])

  const handleError = useCallback((err: Error) => {
    setError(err)
    emitStreamDebug('run-sse:error', {
      runId,
      name: err.name,
      message: err.message,
      lastSeq: cursorRef.current,
    }, 'run-sse')
  }, [runId])

  const handleTokenRefresh = useCallback(async (): Promise<string> => {
    if (isLocalMode()) return accessToken
    return await silentRefresh()
  }, [accessToken])

  const connect = useCallback(() => {
    if (!runId || !accessToken) return

    if (clientRef.current) {
      clientRef.current.close()
    }

    setError(null)

    if (connectedRunIdRef.current !== runId) {
      connectedRunIdRef.current = runId
      cursorRef.current = 0
      eventsRef.current = []
      seenSeqsRef.current.clear()
      notifyEventListeners()
    }

    const stored = readLastSeqFromStorage(runId)
    const nextCursor = Math.max(cursorRef.current, stored)
    cursorRef.current = nextCursor
    emitStreamDebug('run-sse:connect', {
      runId,
      afterSeq: nextCursor,
      url: sseUrl,
    }, 'run-sse')

    const client = createSSEClient({
      url: sseUrl,
      accessToken,
      afterSeq: cursorRef.current,
      follow: true,
      onEvent: handleEvent,
      onStateChange: handleStateChange,
      onError: handleError,
      onTokenRefresh: handleTokenRefresh,
    })

    clientRef.current = client
    void client.connect()
  }, [sseUrl, accessToken, runId, handleEvent, handleStateChange, handleError, handleTokenRefresh, notifyEventListeners])

  const disconnect = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    setError(null)
    emitStreamDebug('run-sse:disconnect', {
      runId,
      lastSeq: cursorRef.current,
    }, 'run-sse')
  }, [runId])

  const reconnect = useCallback(() => {
    setError(null)
    emitStreamDebug('run-sse:reconnect', {
      runId,
      lastSeq: cursorRef.current,
    }, 'run-sse')
    void clientRef.current?.reconnect()
  }, [runId])

  const clearEvents = useCallback(() => {
    eventsRef.current = []
    notifyEventListeners()
  }, [notifyEventListeners])

  const reset = useCallback(() => {
    clearLastSeqInStorage(runId)
    cursorRef.current = 0
    eventsRef.current = []
    seenSeqsRef.current.clear()
    setError(null)
    setState('idle')
    notifyEventListeners()
  }, [notifyEventListeners, runId])

  const subscribeEvents = useCallback((listener: () => void) => {
    eventListenersRef.current.add(listener)
    return () => {
      eventListenersRef.current.delete(listener)
    }
  }, [])

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  // 卸载时 flush 待落盘的 seq
  useEffect(() => {
    return () => {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current)
        storageTimerRef.current = null
      }
      if (cursorRef.current > 0) {
        writeLastSeqToStorage(runId, cursorRef.current)
      }
    }
  }, [runId])

  return useMemo(() => ({
    get events() {
      return eventsRef.current
    },
    state,
    get lastSeq() {
      return cursorRef.current
    },
    error,
    subscribeEvents,
    connect,
    disconnect,
    reconnect,
    clearEvents,
    reset,
  }), [state, error, subscribeEvents, connect, disconnect, reconnect, clearEvents, reset])
}
