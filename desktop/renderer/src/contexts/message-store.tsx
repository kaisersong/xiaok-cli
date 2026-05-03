import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { listMessages, type MessageResponse } from '../api'
import { findAssistantMessageForRun } from '../runEventProcessing'
import { type Attachment } from '../components/ChatInput'
import { useAuth } from './auth'
import { useChatSession } from './chat-session'

interface MessageStoreContextValue {
  messages: MessageResponse[]
  messagesLoading: boolean
  attachments: Attachment[]
  userEnterMessageId: string | null
  pendingIncognito: boolean

  sendMessageRef: React.RefObject<((text: string) => void) | null>
  attachmentsRef: React.RefObject<Attachment[]>

  setMessages: (msgs: MessageResponse[] | ((prev: MessageResponse[]) => MessageResponse[])) => void
  upsertLocalTerminalMessage: (message: MessageResponse) => void
  setMessagesLoading: (v: boolean) => void
  setAttachments: (v: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void
  addAttachment: (a: Attachment) => void
  removeAttachment: (id: string) => void
  setUserEnterMessageId: (v: string | null) => void
  setPendingIncognito: (v: boolean) => void
  beginMessageSync: () => number
  isMessageSyncCurrent: (version: number) => boolean
  invalidateMessageSync: () => void
  readConsistentMessages: (requiredCompletedRunId?: string) => Promise<MessageResponse[]>
  refreshMessages: (options?: { syncVersion?: number; requiredCompletedRunId?: string }) => Promise<MessageResponse[]>
  wasLoadingRef: React.RefObject<boolean>
}

const Ctx = createContext<MessageStoreContextValue | null>(null)

const LOCAL_TERMINAL_MESSAGE_PREFIX = 'local-terminal-run:'

export function isLocalTerminalMessage(message: Pick<MessageResponse, 'id'>): boolean {
  return message.id.startsWith(LOCAL_TERMINAL_MESSAGE_PREFIX)
}

function insertMessageByCreatedAt(messages: MessageResponse[], message: MessageResponse): MessageResponse[] {
  if (messages.some((item) => item.id === message.id)) return messages
  const messageTime = Date.parse(message.created_at)
  if (!Number.isFinite(messageTime)) return [...messages, message]
  const index = messages.findIndex((item) => {
    const itemTime = Date.parse(item.created_at)
    return Number.isFinite(itemTime) && itemTime > messageTime
  })
  if (index < 0) return [...messages, message]
  return [...messages.slice(0, index), message, ...messages.slice(index)]
}

function mergeLocalTerminalMessages(
  remoteMessages: MessageResponse[],
  localMessages: Map<string, MessageResponse>,
): MessageResponse[] {
  const remoteRunIds = new Set<string>()
  for (const message of remoteMessages) {
    if (isLocalTerminalMessage(message)) continue
    if (message.role === 'assistant' && message.run_id) remoteRunIds.add(message.run_id)
  }
  for (const [id, message] of localMessages) {
    if (message.run_id && remoteRunIds.has(message.run_id)) {
      localMessages.delete(id)
    }
  }

  let merged = remoteMessages.filter((message) => !isLocalTerminalMessage(message))
  for (const message of localMessages.values()) {
    if (message.run_id && remoteRunIds.has(message.run_id)) continue
    merged = insertMessageByCreatedAt(merged, message)
  }
  return merged
}

export function MessageStoreProvider({ children }: { children: ReactNode }) {
  const { threadId } = useChatSession()
  return (
    <MessageStoreProviderContent key={threadId ?? '__no_thread__'} threadId={threadId}>
      {children}
    </MessageStoreProviderContent>
  )
}

function MessageStoreProviderContent({ children, threadId }: { children: ReactNode; threadId: string | null }) {
  const { accessToken } = useAuth()

  const [messages, setMessagesState] = useState<MessageResponse[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [userEnterMessageId, setUserEnterMessageId] = useState<string | null>(null)
  const [pendingIncognito, setPendingIncognito] = useState(false)

  const sendMessageRef = useRef<((text: string) => void) | null>(null)
  const attachmentsRef = useRef<Attachment[]>(attachments)
  const localTerminalMessagesRef = useRef<Map<string, MessageResponse>>(new Map())
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])

  const messageSyncVersionRef = useRef(0)
  const wasLoadingRef = useRef(false)
  const addAttachment = useCallback((a: Attachment) => {
    setAttachments((prev) => [...prev, a])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const beginMessageSync = useCallback(() => {
    messageSyncVersionRef.current += 1
    return messageSyncVersionRef.current
  }, [])

  const isMessageSyncCurrent = useCallback((version: number) => {
    return messageSyncVersionRef.current === version
  }, [])

  const invalidateMessageSync = useCallback(() => {
    messageSyncVersionRef.current += 1
  }, [])

  const setMessages = useCallback((value: MessageResponse[] | ((prev: MessageResponse[]) => MessageResponse[])) => {
    setMessagesState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      return next
    })
  }, [])

  const upsertLocalTerminalMessage = useCallback((message: MessageResponse) => {
    localTerminalMessagesRef.current.set(message.id, message)
    setMessages((prev) => mergeLocalTerminalMessages(prev, localTerminalMessagesRef.current))
  }, [setMessages])

  const readConsistentMessages = useCallback(async (requiredCompletedRunId?: string): Promise<MessageResponse[]> => {
    if (!threadId) return []
    let items = await listMessages(accessToken, threadId)
    items = mergeLocalTerminalMessages(items, localTerminalMessagesRef.current)
    if (requiredCompletedRunId && !findAssistantMessageForRun(items, requiredCompletedRunId)) {
      const retriedItems = await listMessages(accessToken, threadId)
      items = mergeLocalTerminalMessages(retriedItems, localTerminalMessagesRef.current)
    }
    return items
  }, [accessToken, threadId])

  const refreshMessages = useCallback(async (options?: {
    syncVersion?: number
    requiredCompletedRunId?: string
  }): Promise<MessageResponse[]> => {
    if (!threadId) return []
    const syncVersion = options?.syncVersion ?? beginMessageSync()
    const items = await readConsistentMessages(options?.requiredCompletedRunId)
    if (!isMessageSyncCurrent(syncVersion)) return []
    setMessages(items)
    return items
  }, [threadId, beginMessageSync, readConsistentMessages, isMessageSyncCurrent, setMessages])

  const value = useMemo<MessageStoreContextValue>(() => ({
    messages,
    messagesLoading,
    attachments,
    userEnterMessageId,
    pendingIncognito,
    sendMessageRef,
    attachmentsRef,
    setMessages,
    upsertLocalTerminalMessage,
    setMessagesLoading,
    setAttachments,
    addAttachment,
    removeAttachment,
    setUserEnterMessageId,
    setPendingIncognito,
    beginMessageSync,
    isMessageSyncCurrent,
    invalidateMessageSync,
    readConsistentMessages,
    refreshMessages,
    wasLoadingRef,
  }), [
    messages,
    messagesLoading,
    attachments,
    userEnterMessageId,
    pendingIncognito,
    addAttachment,
    removeAttachment,
    setMessages,
    upsertLocalTerminalMessage,
    beginMessageSync,
    isMessageSyncCurrent,
    invalidateMessageSync,
    readConsistentMessages,
    refreshMessages,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMessageStore(): MessageStoreContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMessageStore must be used within MessageStoreProvider')
  return ctx
}
