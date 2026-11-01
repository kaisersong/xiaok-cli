import {describe,it,expect,vi} from 'vitest';
import {createYzjCalendarCliReader,type YzjCalendarCliRun} from '../../electron/yunzhijia-calendar-cli.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const window={from:Date.parse('2026-11-01T00:00:00Z'),to:Date.parse('2026-11-08T00:00:00Z')};
const initial={profile:'xiaok-assistant-test',epoch:1,accountId:'local-account',enabled:true,consent:true};
function fixture(reply:unknown={success:true,identity:'user',data:{list:[],more:false,count:0}}){
 let grant={...initial};
 const run=vi.fn<YzjCalendarCliRun>().mockResolvedValue({exitCode:0,stdout:JSON.stringify(reply),stderr:''});
 const reader=createYzjCalendarCliReader({nativeBinary:join(tmpdir(),process.platform==='win32'?'yzj-cli.exe':'yzj-cli'),profile:initial.profile,currentGrant:()=>grant,run});
 return {reader,run,setGrant:(next:typeof grant)=>{grant=next;}};
}
describe('Yunzhijia calendar native read port',()=>{
 it('uses only a fixed native list command and explicit frozen window/profile',async()=>{
  const f=fixture();const result=await f.reader.listEvents(window);
  expect(f.run).toHaveBeenCalledWith(expect.any(String),['--profile',initial.profile,'calendar','event','list','--start',String(window.from),'--end',String(window.to-1)],expect.objectContaining({timeoutMs:30000,maxOutputBytes:1024*1024}));
  expect(result).toMatchObject({records:[],completeness:'complete',grantEpoch:1});
 });
 it.each([
  [{list:[],more:true,count:0},'partial'],[{list:[],pageToken:'next'},'partial'],[{list:[]},'unknown'],
  [{list:[{id:'one'}],more:false,total:2,count:1},'partial'],[{list:[{id:'one'}],more:false,count:1},'complete']
 ])('preserves enumeration uncertainty for %j',async(data,status)=>{
  expect((await fixture({success:true,identity:'user',data}).reader.listEvents(window)).completeness).toBe(status);
 });
 it('rejects disabled grants before invoking a child process',async()=>{
  const f=fixture();f.setGrant({...initial,enabled:false});
  await expect(f.reader.listEvents(window)).rejects.toThrow('yzj_calendar_consent_required');expect(f.run).not.toHaveBeenCalled();
 });
 it('rejects app identity, malformed receipts and contradictory count',async()=>{
  for(const data of [{success:true,identity:'app',data:{list:[],more:false}},{success:true,identity:'user',data:[]},{success:true,identity:'user',data:{list:[],count:5,more:false}}])
   await expect(fixture(data).reader.listEvents(window)).rejects.toThrow();
 });
 it('drops late output after a grant epoch or account change',async()=>{
  const f=fixture();f.run.mockImplementation(async()=>{f.setGrant({...initial,epoch:2});return {exitCode:0,stdout:JSON.stringify({success:true,identity:'user',data:{list:[],more:false}}),stderr:''};});
  await expect(f.reader.listEvents(window)).rejects.toThrow('yzj_calendar_grant_changed');
 });
 it('never exposes provider stderr or accepts a successful-looking nonzero result',async()=>{
  const f=fixture();f.run.mockResolvedValue({exitCode:3,stdout:JSON.stringify({success:true,identity:'user',data:{list:[],more:false}}),stderr:'secret-token private title'});
  await expect(f.reader.listEvents(window)).rejects.toThrow('yzj_calendar_authentication_required');
 });
 it('limits ids, windows and output size before accepting any result',async()=>{
  const f=fixture();await expect(f.reader.getEvent({id:'--endpoint\nsecret'})).rejects.toThrow();
  await expect(f.reader.listEvents({...window,to:window.from})).rejects.toThrow();
  await expect(f.reader.listEvents({...window,to:window.from+9*86400000})).rejects.toThrow();
  expect(f.run).not.toHaveBeenCalled();
  f.run.mockResolvedValue({exitCode:0,stdout:'x'.repeat(1024*1024+1),stderr:''});
  await expect(f.reader.listEvents(window)).rejects.toThrow('yzj_calendar_output_limit');
 });
 it('uses get by opaque id without enabling writes or caller selected flags',async()=>{
  const f=fixture({success:true,identity:'user',data:{id:'event-1',title:'private event'}});
  expect((await f.reader.getEvent({id:'event-1'})).record).toEqual({id:'event-1',title:'private event'});
  expect(f.run.mock.calls[0]?.[1]).toEqual(['--profile',initial.profile,'calendar','event','get','--id','event-1']);
 });
});
