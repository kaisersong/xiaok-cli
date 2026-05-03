import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CodeExecution } from '../components/CodeExecutionCard'
import type { ArtifactRef, SubAgentRef } from '../storage'
import { useRightPanelActions } from './app-ui'

export type DocumentPanelState = {
  artifact: ArtifactRef
  artifacts: ArtifactRef[]
  runId?: string
}

type ActivePanel =
  | { type: 'source'; messageId: string }
  | { type: 'code'; execution: CodeExecution }
  | { type: 'document'; artifact: DocumentPanelState }
  | { type: 'agent'; agent: SubAgentRef }
  | null

type ShareModalState = {
  open: boolean
  sharingMessageId: string | null
  sharedMessageId: string | null
}

type PanelContextValue = {
  activePanel: ActivePanel
  shareModal: ShareModalState
  openSourcePanel: (messageId: string) => void
  openCodePanel: (execution: CodeExecution) => void
  openDocumentPanel: (state: DocumentPanelState) => void
  openAgentPanel: (agent: SubAgentRef) => void
  closePanel: () => void
  openShareModal: (messageId?: string) => void
  closeShareModal: () => void
  setShareState: (sharingId: string | null, sharedId: string | null) => void
}

const Ctx = createContext<PanelContextValue | null>(null)

// Lightweight context: only the artifact key of the active document panel.
// Changing activePanel does NOT propagate through this context unless the
// document artifact key itself changes, avoiding cascading re-renders in
// MessageList / MessageBubble / MarkdownRenderer.
const ActiveArtifactKeyContext = createContext<string | null>(null)
export const useActiveArtifactKey = () => useContext(ActiveArtifactKeyContext)

const defaultShareModal: ShareModalState = {
  open: false,
  sharingMessageId: null,
  sharedMessageId: null,
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const { setRightPanelOpen } = useRightPanelActions()

  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [shareModal, setShareModal] = useState<ShareModalState>(defaultShareModal)

  useEffect(() => {
    setRightPanelOpen(activePanel != null)
  }, [activePanel, setRightPanelOpen])

  const openSourcePanel = useCallback((messageId: string) => {
    setActivePanel({ type: 'source', messageId })
  }, [])

  const openCodePanel = useCallback((execution: CodeExecution) => {
    setActivePanel({ type: 'code', execution })
  }, [])

  const openDocumentPanel = useCallback((state: DocumentPanelState) => {
    setActivePanel({ type: 'document', artifact: state })
  }, [])

  const openAgentPanel = useCallback((agent: SubAgentRef) => {
    setActivePanel({ type: 'agent', agent })
  }, [])

  const closePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  const openShareModal = useCallback((messageId?: string) => {
    setShareModal((prev) => ({
      ...prev,
      open: true,
      sharingMessageId: messageId ?? prev.sharingMessageId,
    }))
  }, [])

  const closeShareModal = useCallback(() => {
    setShareModal(defaultShareModal)
  }, [])

  const setShareState = useCallback(
    (sharingId: string | null, sharedId: string | null) => {
      setShareModal((prev) => ({
        ...prev,
        sharingMessageId: sharingId,
        sharedMessageId: sharedId,
      }))
    },
    [],
  )

  const value = useMemo<PanelContextValue>(
    () => ({
      activePanel,
      shareModal,
      openSourcePanel,
      openCodePanel,
      openDocumentPanel,
      openAgentPanel,
      closePanel,
      openShareModal,
      closeShareModal,
      setShareState,
    }),
    [
      activePanel,
      shareModal,
      openSourcePanel,
      openCodePanel,
      openDocumentPanel,
      openAgentPanel,
      closePanel,
      openShareModal,
      closeShareModal,
      setShareState,
    ],
  )

  const activePanelArtifactKey = activePanel?.type === 'document' ? activePanel.artifact.artifact.key : null

  return (
    <Ctx.Provider value={value}>
      <ActiveArtifactKeyContext.Provider value={activePanelArtifactKey}>
        {children}
      </ActiveArtifactKeyContext.Provider>
    </Ctx.Provider>
  )
}

export function usePanels(): PanelContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePanels must be used within PanelProvider')
  return ctx
}
