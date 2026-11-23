import type {ComponentProps} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {ChatView} from '../../renderer/src/components/ChatView';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
vi.mock('../../renderer/src/components/ChatInput',()=>({ChatInput:({value,onChange}:{value:string;onChange:(value:string)=>void})=><textarea aria-label="draft" value={value} onChange={event=>onChange(event.target.value)}/>}));
afterEach(cleanup);
function props():ComponentProps<typeof ChatView>{return{
 thread:{id:'empty',title:'Saved entry',status:'idle',mode:'work',coverage:'complete',createdAt:1,updatedAt:1,starred:false,gtdBucket:'inbox',pinnedAt:null,currentTaskId:null,taskIds:[]},
 emptyContent:<p>Display-only empty state</p>,messages:[],streamingText:'',status:'idle',currentQuestion:null,result:null,generatedFiles:[],prompt:'My unsent draft',
 onPromptChange:vi.fn(),onSubmit:vi.fn(),onAnswer:vi.fn(),onCancel:vi.fn(),canvasOpen:false,onToggleCanvas:vi.fn(),
};}
const view=(p:ComponentProps<typeof ChatView>)=><LocaleProvider><ChatView {...p}/></LocaleProvider>;
it('actual ChatView removes the empty state for a message without remounting or clearing the composer',()=>{
 Element.prototype.scrollIntoView=vi.fn();const p=props(),r=render(view(p));const input=screen.getByLabelText('draft');
 expect(screen.getByText('Display-only empty state')).toBeVisible();expect(input).toHaveValue('My unsent draft');
 r.rerender(view({...p,messages:[{id:'answer',role:'assistant',content:'Visible answer'}]}));
 expect(screen.queryByText('Display-only empty state')).not.toBeInTheDocument();expect(screen.getByText('Visible answer')).toBeVisible();
 expect(screen.getByLabelText('draft')).toBe(input);expect(input).toHaveValue('My unsent draft');expect(p.onSubmit).not.toHaveBeenCalled();expect(p.onPromptChange).not.toHaveBeenCalled();
});
it('actual ChatView streaming gate keeps the empty state from covering arriving output and preserves the draft',()=>{
 Element.prototype.scrollIntoView=vi.fn();const p=props(),r=render(view(p)),input=screen.getByLabelText('draft');
 r.rerender(view({...p,streamingText:'Incoming answer',status:'running'}));
 expect(screen.queryByText('Display-only empty state')).not.toBeInTheDocument();expect(screen.getByText('Incoming answer')).toBeVisible();
 expect(screen.getByLabelText('draft')).toBe(input);expect(input).toHaveValue('My unsent draft');expect(p.onSubmit).not.toHaveBeenCalled();expect(p.onPromptChange).not.toHaveBeenCalled();
});
