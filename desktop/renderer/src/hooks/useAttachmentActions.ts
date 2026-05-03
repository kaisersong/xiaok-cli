import { useCallback, useEffect } from 'react'
import { uploadStagingAttachment } from '../api'
import { useAuth } from '../contexts/auth'
import { useMessageStore } from '../contexts/message-store'
import type { Attachment } from '../components/ChatInput'

export function useAttachmentActions() {
  const { accessToken } = useAuth()
  const { attachments, setAttachments, attachmentsRef } = useMessageStore()

  const revokeDraftAttachment = useCallback((attachment: Attachment) => {
    if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url)
  }, [])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments, attachmentsRef])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => revokeDraftAttachment(attachment))
    }
  }, [attachmentsRef, revokeDraftAttachment])

  const handleAttachFiles = useCallback((files: File[]) => {
    const newAttachments = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      name: file.name,
      size: file.size,
      mime_type: file.type || 'application/octet-stream',
      preview_url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      status: 'uploading' as const,
    }))
    if (newAttachments.length === 0) return
    setAttachments((prev) => {
      const existingIDs = new Set(prev.map((item) => item.id))
      const deduped = newAttachments.filter((item) => !existingIDs.has(item.id))
      return [...prev, ...deduped]
    })
    for (const attachment of newAttachments) {
      uploadStagingAttachment(accessToken, attachment.file)
        .then((uploaded) => {
          setAttachments((prev) =>
            prev.map((current) => current.id === attachment.id ? { ...current, status: 'ready' as const, uploaded } : current),
          )
        })
        .catch(() => {
          setAttachments((prev) =>
            prev.map((current) => current.id === attachment.id ? { ...current, status: 'error' as const } : current),
          )
        })
    }
  }, [accessToken, setAttachments])

  const handlePasteContent = useCallback((text: string) => {
    const ts = Math.floor(Date.now() / 1000)
    const filename = `pasted-${ts}.txt`
    const blob = new Blob([text], { type: 'text/plain' })
    const file = new File([blob], filename, { type: 'text/plain', lastModified: Date.now() })
    const lineCount = text.split('\n').length
    const attachment: Attachment = {
      id: `${filename}-${file.size}-${Date.now()}`,
      file,
      name: filename,
      size: file.size,
      mime_type: 'text/plain',
      status: 'uploading',
      pasted: { text, lineCount },
    }
    setAttachments((prev) => [...prev, attachment])
    uploadStagingAttachment(accessToken, file)
      .then((uploaded) => {
        setAttachments((prev) =>
          prev.map((current) => current.id === attachment.id ? { ...current, status: 'ready' as const, uploaded } : current),
        )
      })
      .catch(() => {
        setAttachments((prev) =>
          prev.map((current) => current.id === attachment.id ? { ...current, status: 'error' as const } : current),
        )
      })
  }, [accessToken, setAttachments])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) revokeDraftAttachment(target)
      return prev.filter((item) => item.id !== id)
    })
  }, [revokeDraftAttachment, setAttachments])

  return {
    revokeDraftAttachment,
    handleAttachFiles,
    handlePasteContent,
    handleRemoveAttachment,
  }
}
