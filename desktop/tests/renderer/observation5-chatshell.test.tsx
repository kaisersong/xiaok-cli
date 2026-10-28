// POSTAPPLY supplemental ordinary UI chain. Copy to desktop/tests/renderer/observation5-chatshell.test.tsx.
// Real ChatShell + ObservationControls + observation bridge + TS preload + Main registrar + real WeakMap.
// Controller/native consent and unrelated ordinary task/history storage are EXPLICIT ordinary surrogates.
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route,useNavigate} from 'react-router-dom';
const state=vi.hoisted(()=>({getThread:vi.fn(),recoverTask:vi.fn(),subscribeTask:vi.fn(),updateThreadTaskId:vi.fn(),updateThreadTitle:vi.fn(),createTask:vi.fn(),createTaskWithFiles:vi.fn()}));
vi.mock('../../renderer/src/api',async original=>{const actual=await original<typeof import('../../renderer/src/api')>();return {...actual,api:{...actual.api,...state}};});
// Ordinary non-Goal domain only; observation bridge directly uses window.xiaokDesktop unchanged.
vi.mock('../../renderer/src/shared/desktop',async original=>{const actual=await original<typeof import('../../renderer/src/shared/desktop')>();return {...actual,getDesktopApi:()=>null,isDesktop:()=>true};});
vi.mock('../../renderer/src/layouts/AppLayout',()=>({useSidebarCollapse:()=>({collapsed:false,setCollapsed(){}}),AppLayout:()=>null}));
vi.mock('../../renderer/src/components/ChatRightSurface',()=>({ChatRightSurface:(p:any)=><div>{p.children}{p.taskContent}</div>}));
vi.mock('../../renderer/src/components/TaskPanel',()=>({TaskPanel:(p:any)=><div>{p.goalContent}</div>}));
vi.mock('../../renderer/src/components/CanvasPanel',()=>({CanvasPanel:()=>null}));
vi.mock('../../renderer/src/components/ChatView',()=>({ChatView:(p:any)=><div>
 {p.inputAccessory}
 <button onClick={()=>void p.onSubmit('/observation')}>open observation</button>
 <button onClick={()=>void p.onSubmit('/observation on')}>observation with old arguments</button>
 <output data-testid="thread-current">{p.thread?.currentTaskId??''}</output><output data-testid="chat-status">{p.status}</output>
 <output data-testid="chat-history">{p.messages?.map((m:any)=>m.content).join('\n')}</output>
 <button type="button" onClick={()=>void p.onSubmit('  owned prompt  ')}>submit ordinary prompt</button>
 <button type="button" onClick={()=>void p.onSubmit('  owned prompt  ',[{filePath:'/tmp/ordinary-fixture.md',name:'ordinary-fixture.md'}])}>submit ordinary files</button>
 </div>}));
import {ChatShell} from '../../renderer/src/components/ChatShell';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {zh} from '../../renderer/src/locales/zh';
import {en} from '../../renderer/src/locales/en';
import {createPreloadApi} from '../../electron/preload-api.js';
import {consumeDesktopObservationApproval} from '../../electron/desktop-observation-approval.js';
import {fixture,getNativeSurrogate} from '../main/observation5-fixture.js';
function record(id:string){return {id,title:'ordinary saved topic',status:'idle',mode:'work',createdAt:1,updatedAt:1,currentTaskId:null,taskIds:[],starred:false,gtdBucket:'inbox',pinnedAt:null};}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function NavigateThread(){const navigate=useNavigate();return <button type="button" onClick={()=>navigate('/t/thread_2')}>change ordinary thread</button>;}
beforeEach(()=>{for(const mock of Object.values(state))mock.mockReset();state.getThread.mockImplementation(async id=>record(id));state.subscribeTask.mockReturnValue(()=>{});state.updateThreadTaskId.mockResolvedValue(undefined);state.updateThreadTitle.mockResolvedValue(undefined);state.createTask.mockResolvedValue({taskId:'ordinary-task'});state.createTaskWithFiles.mockResolvedValue({taskId:'ordinary-file-task'});});
afterEach(()=>{cleanup();delete (window as unknown as {xiaokDesktop?:unknown}).xiaokDesktop;window.localStorage.removeItem('xiaok:locale');});
async function setup(locale:'zh'|'en'='en') {
 window.localStorage.setItem('xiaok:locale',locale);const f=await fixture(),ordinary=f.installControllerSurrogate(),calls:unknown[][]=[];
 window.xiaokDesktop=createPreloadApi({invoke:async(channel:string,...args:unknown[])=>{calls.push([channel,...args]);return Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},...args]);},on(){},off(){},removeListener(){},send(){}} as never);
 const view=render(<MemoryRouter initialEntries={['/t/thread_1']}><LocaleProvider><NavigateThread/><Routes><Route path="/t/:taskId" element={<ChatShell/>}/></Routes></LocaleProvider></MemoryRouter>);
 await screen.findByTestId('chat-status');await waitFor(()=>expect(state.getThread).toHaveBeenCalledWith('thread_1'));
 fireEvent.click(screen.getByRole('button',{name:'open observation'}));await screen.findByRole('region',{name:(locale==='zh'?zh:en).observation.menuTitle});
 return {...f,ordinary,calls,view,labels:(locale==='zh'?zh:en).observation};
}
it.each(['zh','en'] as const)('%s ChatShell native draft -> real bridge/preload/Main create consumes real approval once, exact thread/prompt/materials and updates thread before subscribe',async locale=>{
 const f=await setup(locale);fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);
 fireEvent.click(screen.getByRole('button',{name:'submit ordinary prompt'}));await waitFor(()=>expect(state.updateThreadTaskId).toHaveBeenCalledWith('thread_1','owned-task'));await waitFor(()=>expect(state.subscribeTask).toHaveBeenCalledWith('owned-task',expect.any(Function)));
 expect(f.ordinary.calls).toHaveLength(1);expect(f.ordinary.calls[0]!.input).toEqual({prompt:'  owned prompt  ',materials:[],permissionMode:'default',threadId:'thread_1'});
 expect(state.updateThreadTaskId.mock.invocationCallOrder[0]).toBeLessThan(state.subscribeTask.mock.invocationCallOrder[0]!);
 expect(()=>consumeDesktopObservationApproval((f.ordinary.calls[0]!.authority as any).approval)).toThrow('observation_user_approval_required');
 const createWire=f.calls.find(call=>call[0]==='desktop:createObservationTask')!;expect(createWire).toHaveLength(2);expect(Object.keys(createWire[1] as object).sort()).toEqual(['draftId','prompt','threadId']);
 await expect(window.xiaokDesktop.createObservationTask(createWire[1] as any)).rejects.toThrow('observation_draft_invalid');expect(f.ordinary.calls).toHaveLength(1);expect(state.createTask).not.toHaveBeenCalled();expect(state.createTaskWithFiles).not.toHaveBeenCalled();
});
it.each(['zh','en'] as const)('%s ChatShell files cannot consume observation draft; same draft still succeeds without files',async locale=>{
 const f=await setup(locale);fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);fireEvent.click(screen.getByRole('button',{name:'submit ordinary files'}));
 expect(f.ordinary.calls).toHaveLength(0);expect(f.calls.filter(call=>call[0]==='desktop:createObservationTask')).toHaveLength(0);expect(state.createTaskWithFiles).not.toHaveBeenCalled();expect(state.updateThreadTaskId).not.toHaveBeenCalled();expect(screen.getByText(f.labels.ready)).toBeTruthy();
 // Expected possible real RED: ordinary non-Goal error visibility, not a fixture qualification.
 await screen.findByText(f.labels.filesUnsupported);
 fireEvent.click(screen.getByRole('button',{name:'submit ordinary prompt'}));await waitFor(()=>expect(f.ordinary.calls).toHaveLength(1));expect(f.ordinary.calls[0]!.input).toEqual({prompt:'  owned prompt  ',materials:[],permissionMode:'default',threadId:'thread_1'});
});
it('ChatShell local draft cancel invokes no permission revoke; ordinary file submit follows original separate task path',async()=>{
 const f=await setup();fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);fireEvent.click(screen.getByRole('button',{name:f.labels.cancel}));await screen.findByRole('button',{name:f.labels.enable});fireEvent.click(screen.getByRole('button',{name:'submit ordinary files'}));await waitFor(()=>expect(state.createTaskWithFiles).toHaveBeenCalledWith({prompt:'  owned prompt  ',filePaths:['/tmp/ordinary-fixture.md'],context:{threadId:'thread_1'}}));expect(f.ordinary.calls).toHaveLength(0);expect(f.ordinary.revokes).toHaveLength(0);expect(f.calls.some(call=>call[0]==='desktop:revokeObservationTask')).toBe(false);
});
it('ChatShell create rejection consumes draft once, returns to idle, and does not retry or switch to ordinary task automatically',async()=>{
 const f=await setup();let effects=0;f.service.createObservationTask=(async(_input:any,authority:any)=>{consumeDesktopObservationApproval(authority.approval);effects++;throw Error('owned-controller-rejection');}) as never;fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);fireEvent.click(screen.getByRole('button',{name:'submit ordinary prompt'}));await waitFor(()=>expect(screen.getByTestId('chat-status').textContent).toBe('idle'));await waitFor(()=>expect(effects).toBe(1));expect(f.calls.filter(call=>call[0]==='desktop:createObservationTask')).toHaveLength(1);expect(state.createTask).not.toHaveBeenCalled();expect(state.createTaskWithFiles).not.toHaveBeenCalled();expect(state.updateThreadTaskId).not.toHaveBeenCalled();expect(state.subscribeTask).not.toHaveBeenCalled();expect(screen.queryByText(f.labels.ready)).toBeNull();
 const wire=f.calls.find(call=>call[0]==='desktop:createObservationTask')!;await expect(window.xiaokDesktop.createObservationTask(wire[1] as any)).rejects.toThrow('observation_draft_invalid');expect(effects).toBe(1);
});
it('ChatShell held create after thread switch cannot update or subscribe the old thread, despite the consumed approval',async()=>{
 const f=await setup(),held=deferred<any>();let approval:any,effects=0;f.service.createObservationTask=((_input:any,authority:any)=>{consumeDesktopObservationApproval(authority.approval);approval=authority.approval;effects++;return held.promise;}) as never;
 fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);fireEvent.click(screen.getByRole('button',{name:'submit ordinary prompt'}));await waitFor(()=>expect(effects).toBe(1));expect(()=>consumeDesktopObservationApproval(approval)).toThrow('observation_user_approval_required');
 fireEvent.click(screen.getByRole('button',{name:'change ordinary thread'}));await waitFor(()=>expect(state.getThread).toHaveBeenCalledWith('thread_2'));await act(async()=>held.resolve({taskId:'late-task',control:f.ordinary.control}));expect(state.updateThreadTaskId).not.toHaveBeenCalled();expect(state.subscribeTask).not.toHaveBeenCalled();expect(screen.getByTestId('thread-current').textContent).toBe('');
});
it('ChatShell healthy draft submit is one admission, even under two immediate clicks',async()=>{const f=await setup(),held=deferred<any>();let effects=0;f.service.createObservationTask=((_input:any,authority:any)=>{consumeDesktopObservationApproval(authority.approval);effects++;return held.promise;}) as never;fireEvent.click(await screen.findByRole('button',{name:f.labels.enable}));await screen.findByText(f.labels.ready);const button=screen.getByRole('button',{name:'submit ordinary prompt'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(effects).toBe(1));expect(f.calls.filter(call=>call[0]==='desktop:createObservationTask')).toHaveLength(1);await act(async()=>held.resolve({taskId:'owned-task',control:f.ordinary.control}));await waitFor(()=>expect(state.updateThreadTaskId).toHaveBeenCalledWith('thread_1','owned-task'));});
// Layout/ChatView and unrelated ordinary storage are surrogates. ObservationControls, ChatShell,
// the observation bridge methods, preload, Main registrar and WeakMap consumption are production.
// No actual model/controller/native/material/metadata/P4 operations or whole-parent qualification.
it('ChatShell consumes observation status without creating a model task',async()=>{
 const f=await setup();expect(screen.getByRole('button',{name:f.labels.enable})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'observation with old arguments'}));await screen.findByText(f.labels.unavailable);expect(f.ordinary.calls).toHaveLength(0);expect(state.createTask).not.toHaveBeenCalled();expect(f.calls.some(call=>call[0]==='desktop:prepareObservationTask')).toBe(false);
});
it('ChatShell held prepare cannot publish a draft after switching between empty threads',async()=>{
 const f=await setup(),held=deferred<any>();window.xiaokDesktop.prepareObservationTask=()=>held.promise;fireEvent.click(screen.getByRole('button',{name:f.labels.enable}));fireEvent.click(screen.getByRole('button',{name:'change ordinary thread'}));await waitFor(()=>expect(state.getThread).toHaveBeenCalledWith('thread_2'));await act(async()=>held.resolve({draftId:'late-approved',model:'fixture',expiresAt:Date.now()+10000}));expect(screen.queryByText(f.labels.ready)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'submit ordinary prompt'}));await waitFor(()=>expect(state.createTask).toHaveBeenCalled());expect(f.ordinary.calls).toHaveLength(0);
});
