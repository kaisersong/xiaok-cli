import type { EvidenceAnomalyView, LoopDefinitionView, LoopRunView } from '../../api'

function metadataString(metadata: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function metadataStringArray(metadata: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = metadata[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()]
  }
  return []
}

export function getOpenLoopAnomalies(anomalies: EvidenceAnomalyView[]): EvidenceAnomalyView[] {
  return anomalies.filter(anomaly => anomaly.status === 'open')
}

export function getLoopAnomalySuggestedAction(anomaly: EvidenceAnomalyView): string {
  const metadata = anomaly.metadata ?? {}
  const explicit = metadataString(metadata, [
    'suggestedActionSummary',
    'suggestedAction',
    'nextActionSummary',
  ])
  if (explicit) return explicit

  const actions = metadataStringArray(metadata, ['suggestedActions'])
  return actions[0] ?? ''
}

export function getLoopAnomalyLogPaths(anomaly: EvidenceAnomalyView): string[] {
  return metadataStringArray(anomaly.metadata ?? {}, ['logPaths', 'logPath']).slice(0, 3)
}

export function buildLoopDiagnosticsSummary({
  observationLabel, labels,
  loop,
  runs,
  anomalies,
}: {
  observationLabel:(run:LoopRunView)=>string
  labels:{loop:string;status:string;history:string;observation:string;finishedAt:string;openAnomalies:string;owner:string;seen:string;suggestedAction:string;logs:string;none:string}
  loop: LoopDefinitionView
  runs: LoopRunView[]
  anomalies: EvidenceAnomalyView[]
}): string {
  const latestRun = runs[0]
  const openAnomalies = getOpenLoopAnomalies(anomalies)
  const lines = [
    `${labels.loop}: ${loop.title} (${loop.id})`,
    `${labels.status}: ${loop.status}`,
    `${labels.history}: ${latestRun?.status??labels.none}`,
    `${labels.observation}: ${latestRun?observationLabel(latestRun):labels.none}`,
    `${labels.finishedAt}: ${latestRun?new Date(latestRun.finishedAt??latestRun.updatedAt??latestRun.startedAt).toISOString():labels.none}`,
    `${labels.openAnomalies}: ${openAnomalies.length}`,
  ]

  for (const anomaly of openAnomalies) {
    const suggestedAction = getLoopAnomalySuggestedAction(anomaly)
    const logPaths = getLoopAnomalyLogPaths(anomaly)
    lines.push(`- ${anomaly.kind}: ${anomaly.message}`)
    lines.push(`  ${labels.owner}: ${anomaly.ownerKind}/${anomaly.ownerId}`)
    lines.push(`  ${labels.seen}: ${anomaly.seenCount}`)
    if (suggestedAction) lines.push(`  ${labels.suggestedAction}: ${suggestedAction}`)
    if (logPaths.length > 0) lines.push(`  ${labels.logs}: ${logPaths.join(', ')}`)
  }

  return lines.join('\n')
}
