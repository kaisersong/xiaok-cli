import React,{createRef} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {ObservationControls,type ObservationCommandHandle} from '../../renderer/src/components/ObservationControls';
import {zh} from '../../renderer/src/locales/zh';
import {en} from '../../renderer/src/locales/en';
const state=vi.hoisted(()=>({locale:'en',prepare:vi.fn(),status:vi.fn(),stop:vi.fn(),revoke:vi.fn()}));
vi.mock('../../renderer/src/contexts/LocaleContext',()=>({useLocale:()=>({t:state.locale==='zh'?zh:en})}));
vi.mock('../../renderer/src/api',()=>({api:{prepareObservationTask:state.prepare,getObservationTaskStatus:state.status,stopObservationTask:state.stop,revokeObservationTask:state.revoke}}));
afterEach(()=>{cleanup();vi.resetAllMocks();state.locale='en';});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function setup(props:React.ComponentProps<typeof ObservationControls>){
 const ref=createRef<ObservationCommandHandle>(),view=render(<ObservationControls {...props} ref={ref}/>);
 return {...view,run:(command:string)=>ref.current!.execute(command),command:async(command:string)=>{await act(()=>ref.current!.execute(command));},update:(next:typeof props)=>view.rerender(<ObservationControls {...next} ref={ref}/>)};
}
it.each(['en','zh'])('prepare %s cancel/error/success preserves native draft-only contract',async locale=>{
 state.locale=locale;const t=(locale==='zh'?zh:en).observation,onDraft=vi.fn();state.prepare.mockResolvedValueOnce(null).mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce({draftId:'approved',model:'fixture'});
 const view=setup({draftId:null,onDraft,running:false});await view.command('on');expect(onDraft).not.toHaveBeenCalled();await view.command('on');await screen.findByRole('alert');expect(onDraft).not.toHaveBeenCalled();await view.command('on');expect(onDraft).toHaveBeenCalledWith('approved');view.update({draftId:'approved',onDraft,running:false});await view.command('on');expect(state.prepare).toHaveBeenCalledTimes(3);await view.command('off');expect(onDraft).toHaveBeenLastCalledWith(null);expect(state.revoke).not.toHaveBeenCalled();expect(screen.getByText(t.disabled)).toBeTruthy();
});
it('does not publish held prepare into another task or after unmount',async()=>{
 for(const unmount of [false,true]){const held=deferred<any>(),onDraft=vi.fn();state.prepare.mockReturnValueOnce(held.promise);const view=setup({taskId:'old',draftId:null,onDraft,running:false});let operation!:Promise<void>;act(()=>{operation=view.run('on');});if(unmount)view.unmount();else view.update({taskId:'new',draftId:null,onDraft,running:false});await act(async()=>{held.resolve({draftId:'late'});await operation;});expect(onDraft).not.toHaveBeenCalled();view.unmount();}
});
it('held stop cannot override a different task or reset its pending action',async()=>{
 const old=deferred<any>(),next=deferred<any>();state.stop.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 const props={taskId:'old',draftId:null,onDraft:()=>{},running:true},view=setup(props);let first!:Promise<void>,second!:Promise<void>;act(()=>{first=view.run('off');});view.update({...props,taskId:'new'});act(()=>{second=view.run('off');});await act(async()=>{old.resolve({mode:'recall-only'});await first;});expect(screen.queryByText(en.observation.recallOnly)).toBeNull();await view.command('off');expect(state.stop.mock.calls).toEqual([['old'],['new']]);await act(async()=>{next.resolve({mode:'recall-only'});await second;});await screen.findByText(en.observation.recallOnly);
});
it('late status cannot overwrite confirmed capture-stop; read failure retains last good facts',async()=>{
 const stale=deferred<any>();state.status.mockResolvedValueOnce({mode:'active'}).mockReturnValueOnce(stale.promise).mockRejectedValueOnce(Error('read_unavailable'));state.stop.mockResolvedValue({mode:'recall-only'});
 const props={taskId:'task',draftId:null,onDraft:()=>{},running:true,activityRevision:0},view=setup(props);await view.command('status');view.update({...props,activityRevision:1});await view.command('off');await screen.findByText(en.observation.recallOnly);await act(async()=>stale.resolve({mode:'active'}));expect(screen.getByText(en.observation.recallOnly)).toBeTruthy();view.update({...props,activityRevision:2});await screen.findByRole('alert');expect(screen.getByText(en.observation.recallOnly)).toBeTruthy();
});
it.each(['en','zh'])('%s revoke shows stopping rather than terminal; failure does not grant success',async locale=>{
 state.locale=locale;const t=(locale==='zh'?zh:en).observation;state.status.mockResolvedValue({mode:'active'});state.revoke.mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce({mode:'revoked'});
 const props={taskId:'task',draftId:null,onDraft:()=>{},running:true},view=setup(props);await view.command('status');await view.command('revoke');await screen.findByRole('alert');expect(screen.getByText(t.active)).toBeTruthy();await view.command('revoke');await screen.findByText(t.revokedStopping);expect(screen.queryByText(t.closed)).toBeNull();state.status.mockResolvedValue({mode:'revoked'});view.update({...props,running:false});await screen.findByText(t.revoked);expect(state.revoke.mock.calls).toEqual([['task'],['task']]);
});
