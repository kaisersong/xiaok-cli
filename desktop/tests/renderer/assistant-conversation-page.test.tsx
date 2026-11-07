import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AssistantPage } from '../../renderer/src/components/assistant/AssistantPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ASSISTANT_THREAD_ID } from '../../renderer/src/lib/assistant-thread';
const h=vi.hoisted(()=>({ensure:vi.fn()}));
vi.mock('../../renderer/src/api',()=>({api:{ensureAssistantThread:h.ensure}}));
vi.mock('../../renderer/src/hooks/useAssistantWorkspace',()=>({useAssistantWorkspace:()=>({overview:null,errors:{},refresh:vi.fn()})}));
vi.mock('../../renderer/src/components/assistant/AssistantWorkspaceContent',()=>({AssistantWorkspaceContent:({onPrepareSuggestion}: {onPrepareSuggestion:(text:string)=>void})=><button onClick={()=>onPrepareSuggestion('跟进会议')}>prepare-suggestion</button>}));
vi.mock('../../renderer/src/components/ChatShell',()=>({ChatShell:({threadId,emptyContent,draftRequest}:{threadId:string;emptyContent:React.ReactNode;draftRequest?:{text:string}})=><section data-testid="chat-shell" data-thread={threadId}>{emptyContent}<output>{draftRequest?.text}</output></section>}));
const page=()=>render(<MemoryRouter initialEntries={['/assistant']}><LocaleProvider><AssistantPage/></LocaleProvider></MemoryRouter>);
beforeEach(()=>{localStorage.setItem('xiaok:locale','zh');h.ensure.mockReset();h.ensure.mockResolvedValue({id:ASSISTANT_THREAD_ID});});afterEach(cleanup);
it('opens the fixed assistant conversation and prepares suggestions in that same composer',async()=>{
 page();expect(await screen.findByTestId('chat-shell')).toHaveAttribute('data-thread',ASSISTANT_THREAD_ID);expect(h.ensure).toHaveBeenCalledWith('小K助理');
 fireEvent.click(screen.getByText('prepare-suggestion'));expect(screen.getByRole('status')).toHaveTextContent('跟进会议');
});
it('reports initialization failures and only retries after an explicit refresh',async()=>{
 h.ensure.mockRejectedValueOnce(Error('storage unavailable'));page();await screen.findByRole('alert');expect(screen.queryByTestId('chat-shell')).toBeNull();expect(h.ensure).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'刷新状态'}));await screen.findByTestId('chat-shell');expect(h.ensure).toHaveBeenCalledTimes(2);
});
it('does not mount a chat after late initialization completes on an unmounted page',async()=>{
 let done!:(value:unknown)=>void;h.ensure.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}));const view=page();await waitFor(()=>expect(h.ensure).toHaveBeenCalledTimes(1));view.unmount();done({id:ASSISTANT_THREAD_ID});expect(screen.queryByTestId('chat-shell')).toBeNull();
});
