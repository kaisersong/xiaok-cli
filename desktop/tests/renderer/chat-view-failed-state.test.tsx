import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
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


describe('interrupted conversation draft choices',()=>{
beforeEach(()=>{localStorage.setItem('xiaok:locale','zh');Element.prototype.scrollIntoView=vi.fn();});
it('stages one interrupted choice in a preserved draft without sending or answering',()=>{
 const send=vi.fn(),answer=vi.fn();function Example(){const[draft,setDraft]=useState('My saved draft');return <LocaleProvider><output data-testid="preserved-draft">{draft}</output><button onClick={()=>setDraft(draft+' edited')}>edit draft</button><ChatView thread={{id:'qa',title:'QA',status:'failed',mode:'work',createdAt:1,updatedAt:1,starred:false,gtdBucket:'inbox',pinnedAt:null,currentTaskId:'older-cursor',taskIds:['older-cursor','A']}} messages={[]} streamingText="" status="failed" currentQuestion={null} interruptedTask={{taskId:'A',choices:[{id:'one',label:'Synthetic continuation'},{id:'two',label:'Other continuation'}]}} result={null} generatedFiles={[]} prompt={draft} onPromptChange={setDraft} onSubmit={send} onAnswer={answer} onCancel={vi.fn()} canvasOpen={false} onToggleCanvas={vi.fn()}/></LocaleProvider>;}
 render(<Example/>);expect(screen.queryByText(/切换模型/)).toBeNull();expect(screen.getByText('选择后填入输入框，发送即可继续。')).toBeVisible();const choice=screen.getByRole('button',{name:'Synthetic continuation'});fireEvent.click(choice);expect(screen.getByTestId('preserved-draft').textContent).toBe('My saved draft\nSynthetic continuation');fireEvent.click(choice);expect(screen.getByTestId('preserved-draft').textContent).toBe('My saved draft\nSynthetic continuation');fireEvent.click(screen.getByRole('button',{name:'Other continuation'}));expect(screen.getByTestId('preserved-draft').textContent).toBe('My saved draft\nOther continuation');fireEvent.click(screen.getByRole('button',{name:'edit draft'}));fireEvent.click(choice);expect(screen.getByTestId('preserved-draft').textContent).toBe('My saved draft\nOther continuation edited\nSynthetic continuation');expect(send).not.toHaveBeenCalled();expect(answer).not.toHaveBeenCalled();
});

afterEach(cleanup);
});
