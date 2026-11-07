import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <textarea aria-label="draft" defaultValue="保留草稿" /> }));
afterEach(cleanup);
const base = {thread:{id:'thread',title:'scroll',status:'running' as const,mode:'work' as const,createdAt:1,updatedAt:1,starred:false,gtdBucket:'inbox' as const,pinnedAt:null,currentTaskId:'task',taskIds:['task']},messages:[],streamingText:'文字已输出',status:'running' as const,currentQuestion:null,result:null,generatedFiles:[],prompt:'',onPromptChange:vi.fn(),onSubmit:vi.fn(),onAnswer:vi.fn(),onCancel:vi.fn(),canvasOpen:false,onToggleCanvas:vi.fn()};
describe('chat approval arrival scroll', () => {
 it('preserves the reading anchor when an older history page is prepended', () => {
  Element.prototype.scrollTo=vi.fn();
  const current = [{id:'current',role:'user' as const,content:'current prompt'}];
  const old = {id:'old',role:'user' as const,content:'older prompt'};
  let prepended=false;
  const draw=(items:typeof current)=><LocaleProvider><ChatView {...base} messages={items}
    historyContent={<button>Earlier records</button>} /></LocaleProvider>;
  const view=render(draw(current));const scroller=screen.getByTestId('chat-scroll-container');
  Object.defineProperties(scroller,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:100},scrollTop:{configurable:true,value:100,writable:true}});
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    return {top:this.dataset.messageAnchor==='current'?(prepended?450:50):0} as DOMRect;
  });
  fireEvent.click(screen.getByRole('button',{name:'Earlier records'}));
  prepended=true;view.rerender(draw([old,...current]));
  expect(scroller.scrollTop).toBe(500);
  rect.mockRestore();
 });
 it.each([true,false])('follows new approvals only when already at bottom: %s', async atBottom => {
  Element.prototype.scrollIntoView=vi.fn();const scroll=vi.fn();Element.prototype.scrollTo=scroll;
  const draw=(count:number)=><LocaleProvider><ChatView {...base} pendingApprovalCount={count} approvalContent={count ? <section>审批出现</section> : null} /></LocaleProvider>;
  const {rerender}=render(draw(0));const scroller=screen.getByTestId('chat-scroll-container');
  Object.defineProperties(scroller,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:100},scrollTop:{configurable:true,value:atBottom?900:100,writable:true}});
  fireEvent.scroll(scroller);const draft=screen.getByLabelText('draft');draft.focus();scroll.mockClear();
  await act(async()=>rerender(draw(1)));
  expect(scroll).toHaveBeenCalledTimes(atBottom?1:0);
  if(atBottom)expect(scroll).toHaveBeenCalledWith({top:1000,behavior:'instant'});
  expect(draft).toHaveFocus();expect(draft).toHaveValue('保留草稿');
 });
});
