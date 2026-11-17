import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {ThreadListProvider,useThreadList} from '../../renderer/src/contexts/thread-list';
const mocks=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('../../renderer/src/contexts/auth',()=>({useAuth:()=>({accessToken:'local-token'})}));
vi.mock('../../renderer/src/api',()=>({isApiError:()=>false,listThreads:mocks.list,streamThreadRunStateEvents:vi.fn(()=>new Promise(()=>{})),updateThreadMode:vi.fn(),updateThreadSidebarState:vi.fn()}));
function Probe(){const state=useThreadList();return <p>{state.readUnavailable?'read unavailable':'read ready'}</p>;}
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});
it('exposes a failed initial Main read instead of presenting an empty successful history',async()=>{
 mocks.list.mockRejectedValue(Error('continuity_unavailable'));
 render(<ThreadListProvider><Probe/></ThreadListProvider>);
 expect(await screen.findByText('read unavailable')).toBeVisible();
 expect(mocks.list).toHaveBeenCalledWith('local-token',{limit:200,mode:'chat'});
 expect(mocks.list).toHaveBeenCalledWith('local-token',{limit:200,mode:'work'});
});
it('clears the unavailable state only after a later complete read succeeds',async()=>{
 let calls=0;mocks.list.mockImplementation(async()=>{if(++calls<=2)throw Error('continuity_unavailable');return [];});
 render(<ThreadListProvider><Probe/></ThreadListProvider>);
 expect(await screen.findByText('read unavailable')).toBeVisible();
 expect(await screen.findByText('read ready',{}, {timeout:2500})).toBeVisible();
 expect(calls).toBe(4);
});
it('keeps prolonged read failures handled when reconnect enters its slower refresh path',async()=>{
 vi.useFakeTimers();mocks.list.mockRejectedValue(Error('continuity_unavailable'));
 try{
  render(<ThreadListProvider><Probe/></ThreadListProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(700_000);});
  expect(mocks.list.mock.calls.length).toBeGreaterThan(42);
  expect(screen.getByText('read unavailable')).toBeVisible();
 }finally{cleanup();vi.useRealTimers();}
});
