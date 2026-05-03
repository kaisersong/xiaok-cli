import type { MessageResponse } from '../api'
import type { WebSource } from '../storage'

const WEB_CITATION_RE = /【\s*web\s*[:：]\s*\d+\s*】|\[\s*web\s*[:：]\s*\d+\s*\]|\bweb\s*[:：]\s*\d+\b/i

function hasWebCitation(content: string): boolean {
  return WEB_CITATION_RE.test(content)
}

export function resolveMessageSourcesForRender(
  messages: MessageResponse[],
  messageSourcesMap: Map<string, WebSource[]>,
): Map<string, WebSource[]> {
  const resolved = new Map<string, WebSource[]>()
  let latestKnownSources: WebSource[] | undefined

  messages.forEach((msg) => {
    if (msg.role !== 'assistant') return
    const ownSources = messageSourcesMap.get(msg.id)
    if (ownSources && ownSources.length > 0) {
      latestKnownSources = ownSources
      resolved.set(msg.id, ownSources)
      return
    }
    if (latestKnownSources && hasWebCitation(msg.content)) {
      resolved.set(msg.id, latestKnownSources)
    }
  })

  return resolved
}
