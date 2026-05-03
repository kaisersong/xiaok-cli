import { useMemo } from 'react'
import { useMessageMeta } from '../contexts/message-meta'
import type {
  ArtifactRef,
  BrowserActionRef,
  CodeExecutionRef,
  FileOpRef,
  MessageSearchStepRef,
  MessageThinkingRef,
  MsgRunEvent,
  SubAgentRef,
  WebFetchRef,
  WebSource,
  WidgetRef,
} from '../storage'
import type { AssistantTurnUi } from '../assistantTurnSegments'

export function useMessageMetaCompat() {
  const { metaMap } = useMessageMeta()

  return useMemo(() => {
    const sourcesMap = new Map<string, WebSource[]>()
    const artifactsMap = new Map<string, ArtifactRef[]>()
    const widgetsMap = new Map<string, WidgetRef[]>()
    const codeExecutionsMap = new Map<string, CodeExecutionRef[]>()
    const browserActionsMap = new Map<string, BrowserActionRef[]>()
    const subAgentsMap = new Map<string, SubAgentRef[]>()
    const fileOpsMap = new Map<string, FileOpRef[]>()
    const webFetchesMap = new Map<string, WebFetchRef[]>()
    const thinkingMap = new Map<string, MessageThinkingRef>()
    const searchStepsMap = new Map<string, MessageSearchStepRef[]>()
    const assistantTurnMap = new Map<string, AssistantTurnUi>()
    const runEventsMap = new Map<string, MsgRunEvent[]>()

    for (const [id, meta] of metaMap.entries()) {
      if (meta.sources) sourcesMap.set(id, meta.sources)
      if (meta.artifacts) artifactsMap.set(id, meta.artifacts)
      if (meta.widgets) widgetsMap.set(id, meta.widgets)
      if (meta.codeExecutions) codeExecutionsMap.set(id, meta.codeExecutions)
      if (meta.browserActions) browserActionsMap.set(id, meta.browserActions)
      if (meta.subAgents) subAgentsMap.set(id, meta.subAgents)
      if (meta.fileOps) fileOpsMap.set(id, meta.fileOps)
      if (meta.webFetches) webFetchesMap.set(id, meta.webFetches)
      if (meta.thinking) thinkingMap.set(id, meta.thinking)
      if (meta.searchSteps) searchStepsMap.set(id, meta.searchSteps)
      if (meta.assistantTurn) assistantTurnMap.set(id, meta.assistantTurn)
      if (meta.runEvents) runEventsMap.set(id, meta.runEvents)
    }

    return {
      messageSourcesMap: sourcesMap,
      messageArtifactsMap: artifactsMap,
      messageWidgetsMap: widgetsMap,
      messageCodeExecutionsMap: codeExecutionsMap,
      messageBrowserActionsMap: browserActionsMap,
      messageSubAgentsMap: subAgentsMap,
      messageFileOpsMap: fileOpsMap,
      messageWebFetchesMap: webFetchesMap,
      messageThinkingMap: thinkingMap,
      messageSearchStepsMap: searchStepsMap,
      messageAssistantTurnMap: assistantTurnMap,
      msgRunEventsMap: runEventsMap,
    }
  }, [metaMap])
}
