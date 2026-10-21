import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ channels: vi.fn(), mcp: vi.fn(), plugins: vi.fn(), dependencies: vi.fn(), createChannel: vi.fn(), createMcp: vi.fn(), testChannel: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', async importOriginal => {
  const actual = await importOriginal<typeof import('../../renderer/src/api/bridge')>();
  Object.assign(actual.api, { listChannels: mocks.channels, listMCPInstalls: mocks.mcp, listPluginMcpServers: mocks.plugins, listPluginDependencyStatuses: mocks.dependencies,
    testChannel: mocks.testChannel, createChannel: mocks.createChannel, createMCPInstall: mocks.createMcp, getServiceStatus: async () => ({services:[]}), getSkillDebugConfig: async () => ({enabled:false}), getKswarmConfig: async () => ({maxConcurrentTasks:3}) });
  return actual;
});
const channels = [{id:'owned',type:'telegram',name:'Owned channel',enabled:false,createdAt:0,updatedAt:0}];
const installs = [{id:'owned',name:'Owned MCP',source:'local',command:'owned-command',args:['--owned'],enabled:false,createdAt:0}];
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-locale</button>; }
function mount(kind: 'channels'|'mcp') {
  const view = render(<MemoryRouter><LocaleProvider><LocaleButton /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', {name:kind==='channels'?'消息通道':'MCP 服务器'})); return view;
}
beforeEach(() => { localStorage.setItem('xiaok:locale','zh'); mocks.channels.mockReset().mockResolvedValue(channels); mocks.mcp.mockReset().mockResolvedValue(installs); mocks.plugins.mockReset().mockResolvedValue([]); mocks.dependencies.mockReset().mockResolvedValue([]); mocks.testChannel.mockReset(); mocks.createChannel.mockReset(); mocks.createMcp.mockReset(); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); vi.restoreAllMocks(); });
it.each(['channels','mcp'] as const)('shows %s read failure without declaring successful empty facts', async kind => {
  (kind==='channels'?mocks.channels:mocks.mcp).mockRejectedValue(Error('private-reader-failure')); mount(kind);
  expect(await screen.findByText(kind==='channels'?'无法读取消息通道':'无法读取 MCP 安装列表')).toBeInTheDocument();
  expect(screen.queryByText('private-reader-failure')).toBeNull(); expect(mocks.createChannel).not.toHaveBeenCalled(); expect(mocks.createMcp).not.toHaveBeenCalled();
});
it.each(['channels','mcp'] as const)('preserves %s last-good data when a manual retry fails', async kind => {
  mount(kind); await screen.findByText(kind==='channels'?'Owned channel':'Owned MCP');
  (kind==='channels'?mocks.channels:mocks.mcp).mockRejectedValueOnce(Error('private-reader-failure'));
  fireEvent.click(screen.getByRole('button', {name:'重新读取'}));
  expect(await screen.findByText(kind==='channels'?'无法读取消息通道':'无法读取 MCP 安装列表')).toBeInTheDocument();
  expect(screen.getByText(kind==='channels'?'Owned channel':'Owned MCP')).toBeInTheDocument();
  expect(mocks.createChannel).not.toHaveBeenCalled(); expect(mocks.createMcp).not.toHaveBeenCalled();
});
it.each(['channels','mcp'] as const)('drops late %s read after unmount and leaves no reread work', async kind => {
  let release!: (value: unknown) => void; const read=kind==='channels'?mocks.channels:mocks.mcp; read.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));
  const view=mount(kind); view.unmount(); await act(async()=>release(kind==='channels'?channels:installs)); expect(read).toHaveBeenCalledTimes(1); expect(mocks.createChannel).not.toHaveBeenCalled(); expect(mocks.createMcp).not.toHaveBeenCalled();
});
it.each(['channels','mcp'] as const)('coalesces held %s explicit manual reads into only one successor',async kind=>{
 mount(kind);await screen.findByText(kind==='channels'?'Owned channel':'Owned MCP');const read=kind==='channels'?mocks.channels:mocks.mcp;let release!:(value:unknown)=>void;read.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));
 const retry=screen.getByRole('button',{name:'重新读取'});fireEvent.click(retry);fireEvent.click(retry);fireEvent.click(retry);expect(read).toHaveBeenCalledTimes(2);
 await act(async()=>release(kind==='channels'?channels:installs));await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));expect(mocks.createChannel).not.toHaveBeenCalled();expect(mocks.createMcp).not.toHaveBeenCalled();
});
it.each(['channels','mcp'] as const)('keeps current locale %s failures after a previous held read expires',async kind=>{
 const read=kind==='channels'?mocks.channels:mocks.mcp;let reject!:(error:unknown)=>void;read.mockReturnValueOnce(new Promise((_resolve,no)=>{reject=no})).mockRejectedValueOnce(Error('new-scope-failure'));mount(kind);fireEvent.click(screen.getByRole('button',{name:'test-locale'}));await act(async()=>reject(Error('old-scope-failure')));
 expect(await screen.findByText(kind==='channels'?'Unable to read channels':'Unable to read MCP installations')).toBeInTheDocument();expect(screen.queryByText('old-scope-failure')).toBeNull();expect(mocks.createChannel).not.toHaveBeenCalled();expect(mocks.createMcp).not.toHaveBeenCalled();
});

it('readonly retry preserves the original channel test failure and does not resend a test action',async()=>{
 mocks.testChannel.mockResolvedValue({success:false,error:'owned-channel-action-failure'});mount('channels');await screen.findByText('Owned channel');fireEvent.click(screen.getByRole('button',{name:'测试'}));expect(await screen.findByText('owned-channel-action-failure')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await waitFor(()=>expect(mocks.channels).toHaveBeenCalledTimes(2));expect(screen.getByText('owned-channel-action-failure')).toBeInTheDocument();expect(mocks.testChannel).toHaveBeenCalledExactlyOnceWith('owned');
});
it('keeps successful MCP creation original arguments and readonly refresh',async()=>{
 mocks.createMcp.mockResolvedValue(installs[0]);mount('mcp');await screen.findByText('Owned MCP');fireEvent.click(screen.getByRole('button',{name:'添加 MCP 服务器'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:' Owned new '}});fireEvent.change(screen.getByLabelText('命令'),{target:{value:' owned-command '}});fireEvent.change(screen.getByLabelText('参数 (空格分隔，可选)'),{target:{value:' --one  two '}});fireEvent.click(screen.getByRole('button',{name:'创建'}));await waitFor(()=>expect(mocks.createMcp).toHaveBeenCalledExactlyOnceWith({name:'Owned new',source:'npm',command:'owned-command',args:['--one','two']}));await waitFor(()=>expect(mocks.mcp).toHaveBeenCalledTimes(2));expect(mocks.createChannel).not.toHaveBeenCalled();
});
