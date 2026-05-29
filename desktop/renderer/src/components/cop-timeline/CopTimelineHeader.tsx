import { useIncrementalTypewriter } from '../../hooks/useIncrementalTypewriter'

export function CopTimelineHeaderLabel({
  text,
  phaseKey,
  shimmer,
  incremental,
  animationSeedText,
}: {
  text: string
  phaseKey: string
  shimmer?: boolean
  incremental?: boolean
  animationSeedText?: string
}) {
  const displayed = useIncrementalTypewriter(text, incremental, animationSeedText)
  return (
    <span
      data-phase={phaseKey}
      className={shimmer ? 'thinking-shimmer' : undefined}
    >
      {incremental ? displayed : text}
    </span>
  )
}
