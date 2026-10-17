// UNREVIEWED FOLLOWUP controls. Copy to desktop/tests/renderer with this filename.
// Real DesktopSettings/ChannelsPane/McpPane + real bridge; only window transport is controlled.
// npm run test -- --run tests/renderer/channel-mcp-mutation-ui-followup.test.tsx
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
type Kind='channels'|'mcp';
type Action='create'|'delete'|'toggle';
const cases=[['channels','create'],['channels','delete'],['channels','toggle'],['mcp','create'],['mcp','delete']]as const;
const channel={id:'owned',type:'telegram',name:'Owned channel',enabled:true,createdAt:0,updatedAt:0};
const install={id:'owned',name:'Owned MCP',source:'local',command:'owned-command',args:['--owned'],enabled:true,createdAt:0};
const endpoint={listChannels:vi.fn(),listMCPInstalls:vi.fn(),createChannel:vi.fn(),deleteChannel:vi.fn(),updateChannel:vi.fn(),testChannel:vi.fn(),createMCPInstall:vi.fn(),deleteMCPInstall:vi.fn()};
let previous:typeof window.xiaokDesktop;
function deferred<T>(){
 let complete!:(value:T)=>void,reject!:(error:unknown)=>void,settled=false;
 const promise=new Promise<T>((yes,no)=>{complete=yes;reject=no;});
 return {promise,resolve:(value:T)=>{settled=true;complete(value);},reject:(error:unknown)=>{settled=true;reject(error);},get settled(){return settled;}};
}
function LocaleSwitch(){const {setLocale}=useLocale();return <button onClick={()=>setLocale('en')}>followup-locale</button>;}
beforeEach(()=>{
 previous=window.xiaokDesktop;localStorage.setItem('xiaok:locale','zh');for(const mock of Object.values(endpoint))mock.mockReset();
 endpoint.listChannels.mockResolvedValue([channel]);endpoint.listMCPInstalls.mockResolvedValue([install]);
 window.xiaokDesktop={...previous,...endpoint,listPluginMcpServers:async()=>[],listPluginDependencyStatuses:async()=>[],getServiceStatus:async()=>({services:[]}),getSkillDebugConfig:async()=>({enabled:false}),getKswarmConfig:async()=>({maxConcurrentTasks:3})}as never;
 vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'alert').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();window.xiaokDesktop=previous;localStorage.removeItem('xiaok:locale');vi.restoreAllMocks();vi.useRealTimers();});
function read(kind:Kind){return kind==='channels'?endpoint.listChannels:endpoint.listMCPInstalls;}
function action(kind:Kind,name:Action){return kind==='channels'?(name==='create'?endpoint.createChannel:name==='toggle'?endpoint.updateChannel:endpoint.deleteChannel):(name==='create'?endpoint.createMCPInstall:endpoint.deleteMCPInstall);}
function row(name:string){const element=screen.getByText(name).closest('.flex.items-center.justify-between');expect(element).not.toBeNull();return within(element as HTMLElement);}
async function mount(kind:Kind){
 const view=render(<MemoryRouter><LocaleProvider><LocaleSwitch/><DesktopSettings onClose={()=>{}}/></LocaleProvider></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:kind==='channels'?'消息通道':'MCP 服务器'}));await screen.findByText(kind==='channels'?channel.name:install.name);return view;
}
function input(id:string,value:string){const node=document.getElementById(id);expect(node).not.toBeNull();fireEvent.change(node!,{target:{value}});}
function openCreate(kind:Kind){
 fireEvent.click(screen.getByRole('button',{name:kind==='channels'?'添加通道':'添加 MCP 服务器'}));
 if(kind==='channels'){
  input('desktop-channel-name',' Owned new ');input('desktop-channel-type','discord');input('desktop-channel-field-botToken','OWNED_BOT_SECRET');
 }else{input('desktop-mcp-server-name',' Owned new ');input('desktop-mcp-server-command',' owned-command ');input('desktop-mcp-server-args',' --one  two ');}
 return screen.getByRole('button',{name:'创建'});
}
function start(kind:Kind,name:Action){
 const button=name==='create'?openCreate(kind):name==='toggle'?row(channel.name).getByRole('button',{name:'启用中'}):row(kind==='channels'?channel.name:install.name).getAllByRole('button').at(-1)!;
 fireEvent.click(button);return button;
}
function ack(kind:Kind,name:Action){return name==='delete'?undefined:name==='toggle'?{...channel,enabled:false}:kind==='channels'?{...channel,id:'discord',type:'discord',name:'Owned new'}:{...install,id:'created',name:'Owned new'};}
async function finish<T>(held:ReturnType<typeof deferred<T>>,value:T){await act(async()=>{held.resolve(value);await held.promise;});}
function factsVisible(kind:Kind){expect(screen.getByText(kind==='channels'?channel.name:install.name)).toBeInTheDocument();}
function assertOriginalArgs(kind:Kind,name:Action){
 const expected=name==='delete'?['owned']:name==='toggle'?['owned',{enabled:false}]:kind==='channels'?[{type:'discord',name:'Owned new',botToken:'OWNED_BOT_SECRET'}]:[{name:'Owned new',source:'npm',command:'owned-command',args:['--one','two']}];
 expect(action(kind,name)).toHaveBeenCalledExactlyOnceWith(...expected);
}
it.each(cases)('%s/%s held action retains form/facts and does not refresh before actual ACK',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);await mount(kind);const reads=read(kind).mock.calls.length;
 try{start(kind,name);assertOriginalArgs(kind,name);await act(async()=>{await Promise.resolve();});factsVisible(kind);expect(read(kind)).toHaveBeenCalledTimes(reads);
  if(name==='create')expect(document.getElementById(kind==='channels'?'desktop-channel-name':'desktop-mcp-server-name')).toHaveValue(' Owned new ');
  await finish(held,ack(kind,name));await waitFor(()=>expect(read(kind).mock.calls.length).toBeGreaterThan(reads));
 }finally{if(!held.settled)await finish(held,ack(kind,name));}
});
it.each(cases)('%s/%s repeated click during a held action cannot issue duplicate mutations',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);await mount(kind);
 try{const button=start(kind,name);fireEvent.click(button);expect(action(kind,name)).toHaveBeenCalledTimes(1);factsVisible(kind);}finally{await finish(held,ack(kind,name));}
});
it.each(cases)('%s/%s late ACK after unmount cannot restart the readonly owner',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);const view=await mount(kind);start(kind,name);const reads=read(kind).mock.calls.length;view.unmount();
 await finish(held,ack(kind,name));expect(read(kind)).toHaveBeenCalledTimes(reads);expect(window.alert).not.toHaveBeenCalled();expect(action(kind,name)).toHaveBeenCalledTimes(1);
});
it.each(cases)('%s/%s late rejection after unmount cannot publish a global alert',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);const view=await mount(kind);start(kind,name);const reads=read(kind).mock.calls.length;view.unmount();
 await act(async()=>{held.reject(Error('OWNED_EXPIRED_ACTION'));await held.promise.catch(()=>{});});expect(window.alert).not.toHaveBeenCalled();expect(read(kind)).toHaveBeenCalledTimes(reads);
});
it.each(cases)('%s/%s old locale ACK cannot refresh the new lifetime or close/reset its draft',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);await mount(kind);
 try{start(kind,name);fireEvent.click(screen.getByRole('button',{name:'followup-locale'}));await waitFor(()=>expect(read(kind)).toHaveBeenCalledTimes(2));const reads=read(kind).mock.calls.length;
  if(name==='create')input(kind==='channels'?'desktop-channel-name':'desktop-mcp-server-name','Current English draft');
  await finish(held,ack(kind,name));expect(read(kind)).toHaveBeenCalledTimes(reads);factsVisible(kind);
  if(name==='create')expect(document.getElementById(kind==='channels'?'desktop-channel-name':'desktop-mcp-server-name')).toHaveValue('Current English draft');
 }finally{if(!held.settled)await finish(held,ack(kind,name));}
});
it.each(cases)('%s/%s old locale failure cannot publish errors in the new lifetime',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);await mount(kind);start(kind,name);fireEvent.click(screen.getByRole('button',{name:'followup-locale'}));await waitFor(()=>expect(read(kind)).toHaveBeenCalledTimes(2));
 await act(async()=>{held.reject(Error('OWNED_EXPIRED_ACTION'));await held.promise.catch(()=>{});});expect(window.alert).not.toHaveBeenCalled();factsVisible(kind);
});
it.each(cases)('%s/%s successful ACK followed by readonly failure keeps last-good and never resends',async(kind,name)=>{
 const held=deferred<unknown>();action(kind,name).mockReturnValue(held.promise);await mount(kind);
 try{start(kind,name);read(kind).mockRejectedValue(Error('OWNED_READ_AFTER_ACK'));await finish(held,ack(kind,name));
  expect(await screen.findByText(kind==='channels'?'无法读取消息通道':'无法读取 MCP 安装列表')).toBeInTheDocument();factsVisible(kind);assertOriginalArgs(kind,name);expect(window.alert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await waitFor(()=>expect(read(kind).mock.calls.length).toBeGreaterThanOrEqual(3));factsVisible(kind);assertOriginalArgs(kind,name);
 }finally{if(!held.settled)await finish(held,ack(kind,name));}
});
it.each(cases)('%s/%s rejected action keeps last-good, does not refresh, and manual read cannot clear/resend it',async(kind,name)=>{
 const failure=Error('OWNED_ACTION_FAILURE');action(kind,name).mockRejectedValue(failure);await mount(kind);const reads=read(kind).mock.calls.length;start(kind,name);
 await waitFor(()=>expect(window.alert).toHaveBeenCalledTimes(1));factsVisible(kind);expect(read(kind)).toHaveBeenCalledTimes(reads);assertOriginalArgs(kind,name);
 read(kind).mockRejectedValue(Error('OWNED_READ_FAILURE'));fireEvent.click(screen.getByRole('button',{name:'重新读取'}));expect(await screen.findByText(kind==='channels'?'无法读取消息通道':'无法读取 MCP 安装列表')).toBeInTheDocument();factsVisible(kind);assertOriginalArgs(kind,name);expect(window.alert).toHaveBeenCalledTimes(1);
});
it('Channel toggle has a held per-row action owner and repeated clicks cannot duplicate edits',async()=>{
 const held=deferred<unknown>();endpoint.updateChannel.mockReturnValue(held.promise);await mount('channels');
 try{const button=row(channel.name).getByRole('button',{name:'启用中'});fireEvent.click(button);fireEvent.click(button);expect(endpoint.updateChannel).toHaveBeenCalledExactlyOnceWith('owned',{enabled:false});factsVisible('channels');expect(endpoint.listChannels).toHaveBeenCalledTimes(1);}finally{await finish(held,{...channel,enabled:false});}
});
it('Channel tests on different rows retain independent busy states when the first one settles',async()=>{
 const other={...channel,id:'second',name:'Owned second channel'};endpoint.listChannels.mockResolvedValue([channel,other]);const first=deferred<unknown>(),second=deferred<unknown>();
 endpoint.testChannel.mockImplementation((id:string)=>id==='owned'?first.promise:second.promise);await mount('channels');
 try{fireEvent.click(row(channel.name).getByRole('button',{name:'测试'}));fireEvent.click(row(other.name).getByRole('button',{name:'测试'}));await finish(first,{success:true,latencyMs:1});
  const remaining=row(other.name).getByRole('button',{name:'测试'});expect(remaining).toBeDisabled();fireEvent.click(remaining);expect(endpoint.testChannel).toHaveBeenCalledTimes(2);
 }finally{if(!first.settled)await finish(first,{success:true,latencyMs:1});await finish(second,{success:true,latencyMs:2});}
});
it.each(['resolve','reject']as const)('held Channel test %s after locale change cannot publish an obsolete action fact',async mode=>{
 const held=deferred<unknown>();endpoint.testChannel.mockReturnValue(held.promise);await mount('channels');fireEvent.click(row(channel.name).getByRole('button',{name:'测试'}));fireEvent.click(screen.getByRole('button',{name:'followup-locale'}));await waitFor(()=>expect(endpoint.listChannels).toHaveBeenCalledTimes(2));
 await act(async()=>{if(mode==='resolve')held.resolve({success:false,error:'OWNED_EXPIRED_TEST'});else held.reject(Error('OWNED_EXPIRED_TEST'));await held.promise.catch(()=>{});});
 expect(screen.queryByText('OWNED_EXPIRED_TEST')).toBeNull();expect(screen.queryByText('Connection failed')).toBeNull();factsVisible('channels');expect(endpoint.testChannel).toHaveBeenCalledExactlyOnceWith('owned');
});
it('Channel action error and readonly last-good stay independent; a newer successful action clears only the old action error',async()=>{
 endpoint.testChannel.mockResolvedValueOnce({success:false,error:'OWNED_CURRENT_TEST_FAILURE'}).mockResolvedValueOnce({success:true,latencyMs:7});await mount('channels');fireEvent.click(row(channel.name).getByRole('button',{name:'测试'}));await screen.findByText('OWNED_CURRENT_TEST_FAILURE');
 endpoint.listChannels.mockRejectedValue(Error('OWNED_READ_FAILURE'));fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await screen.findByText('无法读取消息通道');expect(screen.getByText('OWNED_CURRENT_TEST_FAILURE')).toBeInTheDocument();factsVisible('channels');expect(endpoint.testChannel).toHaveBeenCalledTimes(1);
 fireEvent.click(row(channel.name).getByRole('button',{name:'测试'}));await screen.findByText('连接成功，延迟 7ms');expect(screen.queryByText('OWNED_CURRENT_TEST_FAILURE')).toBeNull();expect(screen.getByText('无法读取消息通道')).toBeInTheDocument();factsVisible('channels');expect(endpoint.testChannel).toHaveBeenCalledTimes(2);
});
it('held MCP mutation does not acquire or duplicate the two-second readonly poll owner',async()=>{
 const held=deferred<unknown>();endpoint.deleteMCPInstall.mockReturnValue(held.promise);vi.useFakeTimers();
 const view=render(<MemoryRouter><LocaleProvider><LocaleSwitch/><DesktopSettings onClose={()=>{}}/></LocaleProvider></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'MCP 服务器'}));await act(async()=>{await Promise.resolve();});factsVisible('mcp');start('mcp','delete');
 try{await act(async()=>{await vi.advanceTimersByTimeAsync(6_100);});expect(endpoint.listMCPInstalls).toHaveBeenCalledTimes(4);expect(endpoint.deleteMCPInstall).toHaveBeenCalledExactlyOnceWith('owned');factsVisible('mcp');view.unmount();const reads=endpoint.listMCPInstalls.mock.calls.length;
  await finish(held,undefined);await act(async()=>{await vi.advanceTimersByTimeAsync(4_100);});expect(endpoint.listMCPInstalls).toHaveBeenCalledTimes(reads);
 }finally{if(!held.settled)await finish(held,undefined);vi.useRealTimers();}
});
