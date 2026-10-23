import {afterEach,expect,it,vi} from 'vitest';
import {Profiler} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
vi.mock('../../renderer/src/contexts/KSwarmContext',()=>({useKSwarm:()=>({agents:[]})}));
vi.mock('../../renderer/src/lib/desktop',()=>({desktop:{
 listCollaborationRooms:vi.fn(async()=>({ok:true,rooms:Array.from({length:60},(_,index)=>({roomId:String(index),title:`Room ${index}`,revision:1,status:index%2?'archived':'active',lastActivityAt:new Date(Date.UTC(2026,0,1,index%24)).toISOString()}))})),
 onCollaborationRoomEvent:vi.fn(()=>()=>{}),
}}));
import {desktop} from '../../renderer/src/lib/desktop';
import {CollaborationRoomsPage} from '../../renderer/src/components/collaboration/CollaborationRoomsPage';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
afterEach(()=>{cleanup();window.localStorage.clear();});
const sum=(values:number[])=>values.reduce((total,value)=>total+value,0);
function statistics(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],durations:values};}
it('records first archived and complete fresh-array focus refresh commits on the actual component',async()=>{
 const firstArchived:number[]=[],freshRefresh:number[]=[],commits:number[]=[];
 const mount=()=>render(<MemoryRouter><LocaleProvider><Profiler id="actual-rooms-cache-cost" onRender={(_id,_phase,duration)=>commits.push(duration)}><CollaborationRoomsPage/></Profiler></LocaleProvider></MemoryRouter>);
 for(let index=0;index<12;index++){
  mount();await screen.findByText('Room 0');expect(screen.getAllByRole('article')).toHaveLength(30);commits.length=0;
  await act(async()=>{fireEvent.click(screen.getByRole('tab',{name:/已归档/}));});
  expect(commits.length).toBeGreaterThan(0);expect(screen.getAllByRole('article')).toHaveLength(30);expect(screen.queryByText('Room 0')).toBeNull();firstArchived.push(sum(commits));cleanup();window.localStorage.clear();
 }
 mount();await screen.findByText('Room 0');fireEvent.click(screen.getByRole('tab',{name:/已归档/}));fireEvent.click(screen.getByRole('tab',{name:/活跃/}));
 const refresh=async()=>{
  const calls=vi.mocked(desktop.listCollaborationRooms).mock.calls.length;commits.length=0;
  await act(async()=>{fireEvent.focus(window);});
  expect(desktop.listCollaborationRooms).toHaveBeenCalledTimes(calls+1);expect(commits.length).toBeGreaterThan(0);expect(screen.getAllByRole('article')).toHaveLength(30);expect(screen.queryByText('Room 1')).toBeNull();
  const time=screen.getByText('Room 0').closest('article')!.querySelector('time')!;expect(time.title).toBe(new Date('2026-01-01T00:00:00.000Z').toLocaleString('zh'));return sum(commits);
 };
 for(let index=0;index<10;index++)await refresh();for(let index=0;index<60;index++)freshRefresh.push(await refresh());
 expect(firstArchived).toHaveLength(12);expect(freshRefresh).toHaveLength(60);
 const report={scope:'actual component with same synthetic60/visible30 inputs; development Profiler, not installed UI',sourceSha:createHash('sha256').update(readFileSync('renderer/src/components/collaboration/CollaborationRoomsPage.tsx')).digest('hex'),firstArchived:statistics(firstArchived),freshRefresh:statistics(freshRefresh),freshWarmup:10};
 if(process.env.XIAOK_ROOM_CACHE_COST_OUTPUT)writeFileSync(process.env.XIAOK_ROOM_CACHE_COST_OUTPUT,JSON.stringify(report,null,2));
},30000);
