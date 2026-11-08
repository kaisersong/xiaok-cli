import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <textarea aria-label="real-composer-slot" /> }));
afterEach(cleanup);
const thread = { id: 'assistant', title: 'Assistant', status: 'idle' as const, mode: 'work' as const, createdAt: 1, updatedAt: 1, starred: false, gtdBucket: 'inbox' as const, pinnedAt: null, currentTaskId: null, taskIds: [] };
const props = { thread, messages: [], streamingText: '', status: 'idle' as const, currentQuestion: null, result: null, generatedFiles: [], prompt: '', onPromptChange: vi.fn(), onSubmit: vi.fn(), onAnswer: vi.fn(), onCancel: vi.fn(), canvasOpen: false, onToggleCanvas: vi.fn(), emptyContent: <div>assistant-entry</div>, conversationHeader: <div>compact-assistant-card</div> };
it('keeps one composer visible alongside the no-message entry', () => {
 render(<LocaleProvider><ChatView {...props} /></LocaleProvider>);
 expect(screen.getByText('assistant-entry')).toBeVisible(); expect(screen.queryByText('compact-assistant-card')).toBeNull(); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('replaces the entry with the compact card as soon as conversation starts, keeping the composer', () => {
 const ui = (messages: typeof props.messages | Array<{id:string;role:'user';content:string}>) => <LocaleProvider><ChatView {...props} messages={messages} /></LocaleProvider>;
 const view = render(ui([])); view.rerender(ui([{id:'u1',role:'user',content:'Help me plan today'}]));
 expect(screen.queryByText('assistant-entry')).toBeNull(); expect(screen.getByText('compact-assistant-card')).toBeVisible(); expect(screen.getByText('Help me plan today')).toBeVisible(); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('does not show the empty entry over running or failed conversation state', () => {
 const view=render(<LocaleProvider><ChatView {...props} status="running" /></LocaleProvider>); expect(screen.queryByText('assistant-entry')).toBeNull();
 view.rerender(<LocaleProvider><ChatView {...props} status="failed" /></LocaleProvider>); expect(screen.queryByText('assistant-entry')).toBeNull(); expect(screen.getByText('compact-assistant-card')).toBeVisible();
});
it('opens the no-message entry at the top instead of scrolling to the end of its setup content',()=>{
 vi.spyOn(Element.prototype,'scrollHeight','get').mockReturnValue(1400);const scroll=vi.spyOn(Element.prototype,'scrollTo');
 render(<LocaleProvider><ChatView {...props}/></LocaleProvider>);expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({top:1400}));vi.restoreAllMocks();
});
it('positions the morning content once for a notification click and preserves that position while history loads',()=>{vi.spyOn(Element.prototype,'scrollHeight','get').mockReturnValue(1400);const scroll=vi.spyOn(Element.prototype,'scrollTo');try{const messages=[{id:'old',role:'user' as const,content:'Saved history'}];const ui=(next=messages)=><LocaleProvider><ChatView {...props} messages={next} assistantHasMessages assistantContent={<div data-assistant-focus-target>Morning suggestions</div>} assistantFocusKey="notification-click-1"/></LocaleProvider>;const v=render(ui());expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({top:0}));v.rerender(ui([...messages,{id:'later',role:'user',content:'Restored history'}]));expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({top:0}));expect(props.onSubmit).not.toHaveBeenCalled();expect(props.onPromptChange).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();}});

it('waits for the real morning anchor before consuming a pending click and accounts for preceding content',()=>{const original=Element.prototype.getBoundingClientRect;vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){return this.hasAttribute('data-assistant-focus-target')?{top:320,bottom:450,left:0,right:600,width:600,height:130,x:0,y:320,toJSON:()=>({})}:original.call(this)});const scroll=vi.spyOn(Element.prototype,'scrollTo'),handled=vi.fn();try{const ui=(content?:React.ReactNode)=><LocaleProvider><ChatView {...props} assistantHasMessages assistantFocusKey="pending-click" onAssistantFocusHandled={handled} assistantContent={content}/></LocaleProvider>;const v=render(ui());expect(handled).not.toHaveBeenCalled();v.rerender(ui(<><div>credential inputs</div><section data-assistant-focus-target>Morning</section></>));expect(handled).toHaveBeenCalledTimes(1);expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({top:320}));v.rerender(ui(<section data-assistant-focus-target>Changed background content</section>));expect(handled).toHaveBeenCalledTimes(1);}finally{vi.restoreAllMocks();}});

const proactive=(id:string,at:number,kind:'morning'|'test'='test')=>({id,role:'assistant_message' as const,content:'hello '+id,assistantMessage:{id,kind,createdAt:at,title:'Notice '+id,text:'hello '+id}});
it('renders a fresh proactive message after live output and result without submitting anything',()=>{
 const messages=[{id:'u',role:'user' as const,content:'old question'},proactive('new',20)];
 const v=render(<LocaleProvider><ChatView {...props} messages={messages} streamingText="current streaming reply" status="running" assistantHasMessages/></LocaleProvider>);
 const scroller=screen.getByTestId('chat-scroll-container');
 expect(scroller.textContent!.indexOf('current streaming reply')).toBeLessThan(scroller.textContent!.indexOf('hello new'));
 expect(screen.getAllByTestId('assistant-proactive-message')).toHaveLength(1);
 v.rerender(<LocaleProvider><ChatView {...props} messages={messages} assistantHasMessages/></LocaleProvider>);
 expect(screen.getAllByTestId('assistant-proactive-message')).toHaveLength(1);expect(props.onSubmit).not.toHaveBeenCalled();
});
it('preserves a reader who scrolled back when a new message arrives',()=>{const scroll=vi.spyOn(Element.prototype,'scrollTo');try{
 const messages=[{id:'u',role:'user' as const,content:'older question'}];const v=render(<LocaleProvider><ChatView {...props} messages={messages}/></LocaleProvider>);
 const scroller=screen.getByTestId('chat-scroll-container');Object.defineProperties(scroller,{scrollHeight:{value:3000,configurable:true},clientHeight:{value:600,configurable:true},scrollTop:{value:100,writable:true,configurable:true}});fireEvent.scroll(scroller);scroll.mockClear();
 v.rerender(<LocaleProvider><ChatView {...props} messages={[...messages,proactive('new',20)]} assistantHasMessages/></LocaleProvider>);
 expect(scroll).not.toHaveBeenCalled();expect(scroller.scrollTop).toBe(100);
}finally{vi.restoreAllMocks();}});
it('notification focus chooses the newest morning message and never a later test',()=>{const rect=Element.prototype.getBoundingClientRect;vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){const id=this.getAttribute('data-message-id');return id?{top:id==='new'?400:100,bottom:500,left:0,right:600,width:600,height:100,x:0,y:0,toJSON:()=>({})}:rect.call(this)});const scroll=vi.spyOn(Element.prototype,'scrollTo');try{
 render(<LocaleProvider><ChatView {...props} messages={[proactive('old',1,'morning'),proactive('new',2,'morning'),proactive('test',3)]} assistantFocusKey="latest" assistantHasMessages/></LocaleProvider>);
 expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({top:400}));
}finally{vi.restoreAllMocks();}});
