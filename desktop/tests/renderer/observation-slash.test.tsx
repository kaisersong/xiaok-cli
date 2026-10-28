import React, {createRef} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ObservationControls, type ObservationCommandHandle} from '../../renderer/src/components/ObservationControls';
import {ChatInput} from '../../renderer/src/components/ChatInput';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {zh} from '../../renderer/src/locales/zh';
const state=vi.hoisted(()=>({prepareObservationTask:vi.fn(),getObservationTaskStatus:vi.fn(),stopObservationTask:vi.fn(),revokeObservationTask:vi.fn()}));
vi.mock('../../renderer/src/api',()=>({api:{...state,listSkills:vi.fn().mockResolvedValue([]),onSkillsChanged:vi.fn(()=>()=>{})}}));
vi.mock('../../renderer/src/components/ChatModelPicker',()=>({ChatModelPicker:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('renders no permanent controls or status and queries only on request',async()=>{
 const ref=createRef<ObservationCommandHandle>();state.getObservationTaskStatus.mockResolvedValue({mode:'unavailable'});
 const view=render(<LocaleProvider><ObservationControls ref={ref} draftId={null} onDraft={()=>{}} running={false} taskId="ordinary"/></LocaleProvider>);
 expect(view.container.textContent).toBe('');expect(state.getObservationTaskStatus).not.toHaveBeenCalled();
 await act(()=>ref.current!.execute('status'));expect(screen.getByText(zh.observation.unavailable)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:zh.observation.dismiss}));expect(view.container.textContent).toBe('');
});
it('on requires native consent and refuses enable during a running task',async()=>{
 const ref=createRef<ObservationCommandHandle>(),onDraft=vi.fn();state.prepareObservationTask.mockResolvedValueOnce(null).mockResolvedValueOnce({draftId:'approved'});
 const view=render(<LocaleProvider><ObservationControls ref={ref} draftId={null} onDraft={onDraft} running={false}/></LocaleProvider>);
 await act(()=>ref.current!.execute('on'));expect(onDraft).not.toHaveBeenCalled();
 await act(()=>ref.current!.execute('on'));expect(onDraft).toHaveBeenCalledWith('approved');
 view.rerender(<LocaleProvider><ObservationControls ref={ref} draftId={null} onDraft={onDraft} running/></LocaleProvider>);
 await act(()=>ref.current!.execute('on'));expect(state.prepareObservationTask).toHaveBeenCalledTimes(2);expect(screen.getByText(zh.observation.running)).toBeTruthy();
});
it('local commands bypass the running task queue and are discoverable',async()=>{
 const onSubmit=vi.fn(),onQueue=vi.fn();render(<LocaleProvider><ChatInput isRunning onSubmit={onSubmit} onQueue={onQueue} localCommands={[{name:'observation',description:zh.observation.commandHint}]}/></LocaleProvider>);
 const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'/obs'}});
 fireEvent.click(await screen.findByRole('button',{name:/\/observation/}));expect(input).toHaveValue('/observation ');
 fireEvent.change(input,{target:{value:'/observation '}});fireEvent.keyDown(input,{key:'Enter'});
 await waitFor(()=>expect(onSubmit).toHaveBeenCalledWith('/observation',[]));expect(onQueue).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:'next task'}});fireEvent.keyDown(input,{key:'Enter'});expect(onQueue).toHaveBeenCalledWith('next task',[]);
});

it('opens a submenu with state and performs activation/cancellation through its buttons',async()=>{
 state.prepareObservationTask.mockResolvedValue({draftId:'approved'});
 function Harness(){const [draft,setDraft]=React.useState<string|null>(null),ref=createRef<ObservationCommandHandle>();return <LocaleProvider><button onClick={()=>void ref.current!.execute('status')}>open</button><ObservationControls ref={ref} draftId={draft} onDraft={setDraft} running={false}/></LocaleProvider>;}
 render(<Harness/>);expect(screen.queryByRole('region',{name:zh.observation.menuTitle})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'open'}));await screen.findByRole('region',{name:zh.observation.menuTitle});
 expect(state.prepareObservationTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:zh.observation.enable}));
 await screen.findByText(zh.observation.ready);fireEvent.click(screen.getByRole('button',{name:zh.observation.cancel}));await screen.findByText(zh.observation.disabled);expect(state.revokeObservationTask).not.toHaveBeenCalled();
});
it('running submenu provides capture-stop and revoke buttons with distinct outcomes',async()=>{
 const ref=createRef<ObservationCommandHandle>();state.getObservationTaskStatus.mockResolvedValue({mode:'active'});state.stopObservationTask.mockResolvedValue({mode:'recall-only'});state.revokeObservationTask.mockResolvedValue({mode:'revoked'});
 render(<LocaleProvider><ObservationControls ref={ref} draftId={null} onDraft={()=>{}} running taskId="task"/></LocaleProvider>);
 await act(()=>ref.current!.execute('status'));expect(screen.queryByRole('button',{name:zh.observation.enable})).toBeNull();fireEvent.click(screen.getByRole('button',{name:zh.observation.stop}));await screen.findByText(zh.observation.recallOnly);expect(screen.queryByRole('button',{name:zh.observation.stop})).toBeNull();fireEvent.click(screen.getByRole('button',{name:zh.observation.revoke}));await screen.findByText(zh.observation.revokedStopping);expect(state.stopObservationTask).toHaveBeenCalledWith('task');expect(state.revokeObservationTask).toHaveBeenCalledWith('task');
});

it('clears a previous cancellation receipt when main reports the next active state',async()=>{
 const ref=createRef<ObservationCommandHandle>();state.getObservationTaskStatus.mockResolvedValue({mode:'active'});
 const view=render(<LocaleProvider><ObservationControls ref={ref} draftId="approved" onDraft={()=>{}} running={false} taskId="task"/></LocaleProvider>);
 await act(()=>ref.current!.execute('status'));fireEvent.click(screen.getByRole('button',{name:zh.observation.cancel}));await screen.findByText(zh.observation.disabled);
 view.rerender(<LocaleProvider><ObservationControls ref={ref} draftId={null} onDraft={()=>{}} running taskId="task"/></LocaleProvider>);
 await screen.findByText(zh.observation.active);expect(screen.queryByText(zh.observation.disabled)).toBeNull();
});
