import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatView } from '../../renderer/src/components/ChatView'

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input-placeholder" />,
}))

describe('ChatView failed state', () => {
  it('uses a friendly Chinese failed-state message', () => {
    Element.prototype.scrollIntoView = vi.fn()

    render(
      <ChatView
        thread={{
          id: 'thread-failed',
          title: '失败会话',
          status: 'failed',
          mode: 'work',
          createdAt: 1,
          updatedAt: 1,
          starred: false,
          gtdBucket: 'inbox',
          pinnedAt: null,
          currentTaskId: null,
          taskIds: [],
        }}
        messages={[]}
        streamingText=""
        status="failed"
        currentQuestion={null}
        result={null}
        generatedFiles={[]}
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
        canvasOpen={false}
        onToggleCanvas={vi.fn()}
      />
    )

    expect(screen.queryByText('Task failed. Please try again.')).not.toBeInTheDocument()
    expect(screen.getByText(/任务未完成/)).toBeInTheDocument()
  })
})
