import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext'
import { ChatView } from '../../renderer/src/components/ChatView'

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input-placeholder" />,
}))

describe('ChatView failed state', () => {
  afterEach(cleanup);
  it('uses a friendly Chinese failed-state message', () => {
    Element.prototype.scrollIntoView = vi.fn()

    render(
      <LocaleProvider>
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
      </LocaleProvider>
    )

    expect(screen.queryByText('Task failed. Please try again.')).not.toBeInTheDocument()
    expect(screen.getByText(/任务已停止/)).toBeInTheDocument()
    expect(screen.getByText(/执行记录已保留/)).toBeInTheDocument()
  })
})


describe('interrupted decisions are direct actions',()=>{
 beforeEach(()=>{localStorage.setItem('xiaok:locale','zh');Element.prototype.scrollIntoView=vi.fn();});afterEach(cleanup);
 it('calls the continuation handler on click without changing the draft or requiring Send',()=>{const submit=vi.fn(),answer=vi.fn(),change=vi.fn(),resume=vi.fn();render(<LocaleProvider><ChatView thread={{id:'qa',title:'QA',status:'failed',mode:'work',createdAt:1,updatedAt:1,starred:false,gtdBucket:'inbox',pinnedAt:null,currentTaskId:'older-cursor',taskIds:['older-cursor','A']}} messages={[]} streamingText="" status="failed" currentQuestion={null} interruptedTask={{taskId:'A',choices:[{id:'one',label:'Synthetic reply'}]}} onInterruptedChoice={resume} result={null} generatedFiles={[]} prompt="My unsent draft" onPromptChange={change} onSubmit={submit} onAnswer={answer} onCancel={vi.fn()} canvasOpen={false} onToggleCanvas={vi.fn()}/></LocaleProvider>);expect(screen.getByText('点击选项即可继续。')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Synthetic reply'}));expect(resume).toHaveBeenCalledExactlyOnceWith('one');expect(change).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(answer).not.toHaveBeenCalled();});
});
