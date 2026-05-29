import { useCallback, useEffect, useState } from 'react'
import type { useLocale } from '../../contexts/LocaleContext'

export function useThinkingElapsedSeconds(active: boolean, startedAtMs?: number): number {
  const readElapsed = useCallback(() => {
    if (!active || !startedAtMs) return 0
    return Math.max(1, Math.round((Date.now() - startedAtMs) / 1000))
  }, [active, startedAtMs])
  const [elapsed, setElapsed] = useState(readElapsed)

  useEffect(() => {
    if (!active || !startedAtMs) {
      if (!active) setElapsed(0)
      return
    }
    setElapsed(readElapsed())
    const id = setInterval(() => {
      setElapsed(readElapsed())
    }, 1000)
    return () => clearInterval(id)
  }, [active, readElapsed, startedAtMs])

  return elapsed
}

export function formatThinkingHeaderLabel(thinkingHint: string | undefined, elapsedSeconds: number, t: ReturnType<typeof useLocale>['t']): string {
  if (thinkingHint && thinkingHint.trim() !== '') {
    return `${thinkingHint} for ${elapsedSeconds}s`
  }
  return t.copTimelineThinkingForSeconds(elapsedSeconds)
}
