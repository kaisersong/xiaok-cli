import { useState, useEffect } from 'react'
import { readDeveloperShowRunEvents, readDeveloperShowDebugPanel, type MsgRunEvent } from '../storage'

export function useDevTools() {
  const [showRunEvents, setShowRunEvents] = useState(() => readDeveloperShowRunEvents())
  const [showDebugPanel, setShowDebugPanel] = useState(() => readDeveloperShowDebugPanel())
  const [runDetailPanelRunId, setRunDetailPanelRunId] = useState<string | null>(null)
  const [msgRunEventsMap, setMsgRunEventsMap] = useState<Map<string, MsgRunEvent[]>>(new Map())

  useEffect(() => {
    const handleChange = (e: Event) => {
      setShowRunEvents((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener('arkloop:developer_show_run_events', handleChange)
    return () => window.removeEventListener('arkloop:developer_show_run_events', handleChange)
  }, [])

  useEffect(() => {
    const handleChange = (e: Event) => {
      setShowDebugPanel((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener('arkloop:developer_show_debug_panel', handleChange)
    return () => window.removeEventListener('arkloop:developer_show_debug_panel', handleChange)
  }, [])

  return {
    showRunEvents,
    showDebugPanel,
    runDetailPanelRunId,
    setRunDetailPanelRunId,
    msgRunEventsMap,
    setMsgRunEventsMap,
  } as const
}
