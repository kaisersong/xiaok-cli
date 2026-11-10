import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {ContextHistorySearch} from '../../renderer/src/components/ContextHistorySearch';
const state=vi.hoisted(()=>({desktop:null as Record<string,unknown>|null}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.desktop}));
afterEach(()=>{cleanup();state.desktop=null;});
const view=(id:string)=><LocaleProvider><ContextHistorySearch conversationId={id}/></LocaleProvider>;
function setup(){
 const api={searchContextHistory:vi.fn(async()=>({hits:[]})),getHistorySearchConsent:vi.fn(async()=>({enabled:false,revision:0})),listCliArchives:vi.fn(async()=>({items:[{sessionId:'s',available:true,updatedAt:2},{sessionId:'unsupported',available:false,updatedAt:null}]})),previewCliArchive:vi.fn(async()=>({previewId:'p',sessionId:'s',manifestHash:'h',messageCount:2,sample:'CLI_UI_PREVIEW',coverage:'partial'})),claimCliArchive:vi.fn(async()=>({conversationId:'archive',messageCount:2}))};state.desktop=api;return api;
}
it('lists, previews and explicitly imports without automatically granting target model access',async()=>{
 const api=setup();render(view('target'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));fireEvent.click(screen.getByRole('button',{name:'导入 CLI 历史'}));
 await screen.findByRole('button',{name:'s'});expect(api.previewCliArchive).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'unsupported'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'s'}));await screen.findByText('CLI_UI_PREVIEW');expect(api.claimCliArchive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'导入这些历史消息'}));await screen.findByRole('status');await waitFor(()=>expect(api.claimCliArchive).toHaveBeenCalledWith({previewId:'p',manifestHash:'h',operationId:expect.any(String)}));
 expect(screen.queryByText('CLI_UI_PREVIEW')).not.toBeInTheDocument();expect(screen.getByText('已导入 2 条历史消息，可在上方搜索后授权引用。')).toBeVisible();
});
it('discards an old preview when the target conversation changes',async()=>{
 const api=setup();let release!:(value:unknown)=>void;api.previewCliArchive.mockImplementation(()=>new Promise(resolve=>{release=resolve;}) as never);
 const rendered=render(view('old'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));fireEvent.click(screen.getByRole('button',{name:'导入 CLI 历史'}));fireEvent.click(await screen.findByRole('button',{name:'s'}));await waitFor(()=>expect(release).toBeTypeOf('function'));
 rendered.rerender(view('new'));release({previewId:'p',sessionId:'s',manifestHash:'h',messageCount:2,sample:'STALE_PRIVATE_PREVIEW',coverage:'partial'});await waitFor(()=>expect(screen.queryByText('STALE_PRIVATE_PREVIEW')).not.toBeInTheDocument());expect(api.claimCliArchive).not.toHaveBeenCalled();
});
it('clears the preview when claim is denied and leaves a retryable bounded error',async()=>{
 const api=setup();api.claimCliArchive.mockRejectedValueOnce(new Error('cli_source_changed'));render(view('target'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));fireEvent.click(screen.getByRole('button',{name:'导入 CLI 历史'}));fireEvent.click(await screen.findByRole('button',{name:'s'}));await screen.findByText('CLI_UI_PREVIEW');fireEvent.click(screen.getByRole('button',{name:'导入这些历史消息'}));await screen.findByRole('alert');expect(screen.queryByText('CLI_UI_PREVIEW')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'导入这些历史消息'})).not.toBeInTheDocument();
});
