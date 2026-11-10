import {StrictMode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {DesktopSettings} from '../../renderer/src/components/DesktopSettings';
import {LocaleProvider,useLocale} from '../../renderer/src/contexts/LocaleContext';
const mocks=vi.hoisted(()=>({inspect:vi.fn(),prepare:vi.fn(),migrate:vi.fn()}));
vi.mock('../../renderer/src/api/bridge',()=>({api:{
 getSkillDebugConfig:vi.fn().mockResolvedValue({enabled:false}),getKswarmConfig:vi.fn().mockResolvedValue({maxConcurrentTasks:3}),getServiceStatus:vi.fn().mockResolvedValue({checkedAt:1,services:[]}),
 inspectWriterConfiguration:mocks.inspect,prepareWriterConfiguration:mocks.prepare,migrateWriterConfiguration:mocks.migrate,
}}));
const unprepared=()=>({ok:true,state:'unprepared',reason:'none',canPrepare:true,canMigrate:false});
const prepared=()=>({ok:true,state:'prepared',reason:'none',canPrepare:false,canMigrate:false});
function held<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function Language(){const {setLocale}=useLocale();return <button onClick={()=>setLocale('en')}>test-language</button>;}
function mount(strict=false){const tree=<MemoryRouter><LocaleProvider><Language/><DesktopSettings onClose={()=>undefined}/></LocaleProvider></MemoryRouter>;return render(strict?<StrictMode>{tree}</StrictMode>:tree);}
beforeEach(()=>{localStorage.setItem('xiaok:locale','zh');mocks.inspect.mockReset().mockResolvedValue(unprepared());mocks.prepare.mockReset().mockResolvedValue(prepared());mocks.migrate.mockReset();});
afterEach(()=>{cleanup();localStorage.removeItem('xiaok:locale');vi.useRealTimers();});
it('the live GeneralPane exposes new-workspace preparation and leaves automatic execution upgrade unavailable',async()=>{
 mount();expect(await screen.findByRole('heading',{name:'项目数据准备'})).toBeInTheDocument();const button=screen.getByRole('button',{name:'准备新工作区'});await waitFor(()=>expect(button).toBeEnabled());
 expect(screen.getByRole('button',{name:'自动执行升级暂不可用'})).toBeDisabled();mocks.inspect.mockResolvedValue(prepared());fireEvent.click(button);
 expect(await screen.findByText('项目数据存储已准备')).toBeInTheDocument();await waitFor(()=>expect(mocks.inspect).toHaveBeenCalledTimes(2));expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(mocks.migrate).not.toHaveBeenCalled();
});
it('localizes an initial read failure and allows a read without starting a mutation',async()=>{
 mocks.inspect.mockRejectedValueOnce(Error('private-reader-detail'));mount();expect(await screen.findByText('无法读取项目数据准备状态')).toBeInTheDocument();expect(screen.getByRole('button',{name:'准备新工作区'})).toBeDisabled();expect(screen.queryByText('private-reader-detail')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'读取准备状态'}));await waitFor(()=>expect(screen.getByRole('button',{name:'准备新工作区'})).toBeEnabled());expect(mocks.prepare).not.toHaveBeenCalled();
});
it('a later failed read removes actionable stale eligibility',async()=>{
 mount();await waitFor(()=>expect(screen.getByRole('button',{name:'准备新工作区'})).toBeEnabled());mocks.inspect.mockRejectedValueOnce(Error('late-read'));
 fireEvent.click(screen.getByRole('button',{name:'读取准备状态'}));await screen.findByText('无法读取项目数据准备状态');expect(screen.getByRole('button',{name:'准备新工作区'})).toBeDisabled();
});
it('locks duplicate clicks and reads synchronously while the original preparation is pending',async()=>{
 const pending=held<ReturnType<typeof prepared>>();mocks.prepare.mockReturnValueOnce(pending.promise);mount();const button=screen.getByRole('button',{name:'准备新工作区'});await waitFor(()=>expect(button).toBeEnabled());
 fireEvent.click(button);fireEvent.click(button);fireEvent.click(screen.getByRole('button',{name:'读取准备状态'}));expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(mocks.inspect).toHaveBeenCalledTimes(1);
 mocks.inspect.mockResolvedValue(prepared());await act(async()=>pending.resolve(prepared()));await screen.findByText('项目数据存储已准备');
});
it('readback and a locale change cannot clear an unknown preparation or retry the mutation',async()=>{
 mocks.prepare.mockRejectedValueOnce(Error('private-mutation-detail'));mount();await waitFor(()=>expect(screen.getByRole('button',{name:'准备新工作区'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'准备新工作区'}));
 expect(await screen.findByText('准备操作结果尚未确认，请读取状态；不会自动重试。')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'读取准备状态'}));await waitFor(()=>expect(mocks.inspect).toHaveBeenCalledTimes(2));
 expect(screen.getByRole('button',{name:'准备新工作区'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'test-language'}));expect(await screen.findByText('The preparation outcome is unknown. Read the status; it will not be retried automatically.')).toBeInTheDocument();expect(mocks.inspect).toHaveBeenCalledTimes(2);expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(screen.queryByText('private-mutation-detail')).toBeNull();
});
it('StrictMode shares one pending readonly observation instead of issuing a second busy owned-channel request',async()=>{
 const pending=held<ReturnType<typeof unprepared>>();let active=false;mocks.inspect.mockImplementation(()=>{if(active)return Promise.reject(Error('OWNED_CONTROL_BUSY'));active=true;return pending.promise;});mount(true);
 await act(async()=>Promise.resolve());expect(mocks.inspect).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'准备新工作区'})).toBeDisabled();await act(async()=>pending.resolve(unprepared()));await waitFor(()=>expect(screen.getByRole('button',{name:'准备新工作区'})).toBeEnabled());
});
it('unmounting drops a late reply without following it with another read or claiming cancellation',async()=>{
 const pending=held<ReturnType<typeof prepared>>();mocks.prepare.mockReturnValueOnce(pending.promise);const mounted=mount();await waitFor(()=>expect(screen.getByRole('button',{name:'准备新工作区'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'准备新工作区'}));mounted.unmount();await act(async()=>pending.resolve(prepared()));expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(mocks.inspect).toHaveBeenCalledTimes(1);
});
