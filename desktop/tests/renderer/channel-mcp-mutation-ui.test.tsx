// UNREVIEWED RED CANDIDATE: desktop/tests/renderer/channel-mcp-mutation-ui.test.tsx
// cd desktop && npm run test -- --run tests/renderer/channel-mcp-mutation-ui.test.tsx
// Uses real DesktopSettings + real bridge. Only window transport endpoint is replaced.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const channels=[{id:'owned',type:'telegram',name:'Owned channel',enabled:true,createdAt:0,updatedAt:0}];
const installs=[{id:'owned',name:'Owned MCP',source:'local',command:'owned-command',enabled:true,createdAt:0}];
let previous:typeof window.xiaokDesktop;
const endpoint={listChannels:vi.fn(),listMCPInstalls:vi.fn(),testChannel:vi.fn(),deleteChannel:vi.fn(),deleteMCPInstall:vi.fn(),updateChannel:vi.fn()};
beforeEach(()=>{
 previous=window.xiaokDesktop;localStorage.setItem('xiaok:locale','zh');
 for(const mock of Object.values(endpoint))mock.mockReset();endpoint.listChannels.mockResolvedValue(channels);endpoint.listMCPInstalls.mockResolvedValue(installs);
 window.xiaokDesktop={...previous,...endpoint,listPluginMcpServers:async()=>[],listPluginDependencyStatuses:async()=>[],getServiceStatus:async()=>({services:[]}),getSkillDebugConfig:async()=>({enabled:false}),getKswarmConfig:async()=>({maxConcurrentTasks:3})}as never;
});
afterEach(()=>{cleanup();window.xiaokDesktop=previous;localStorage.removeItem('xiaok:locale');vi.restoreAllMocks();});
async function mount(kind:'channels'|'mcp'){
 render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={()=>{}} /></LocaleProvider></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:kind==='channels'?'消息通道':'MCP 服务器'}));await screen.findByText(kind==='channels'?'Owned channel':'Owned MCP');
}
function deleteButton(kind:'channels'|'mcp'){
 // Current production has no accessible delete label. Locate the actual row's last button;
 // proposed patch adds locale aria-label without making the RED depend on that change.
 const name=screen.getByText(kind==='channels'?'Owned channel':'Owned MCP');const card=name.closest('.flex.items-center.justify-between');expect(card).not.toBeNull();
 const buttons=within(card as HTMLElement).getAllByRole('button');return buttons[buttons.length-1]!;
}
it.each(['channels','mcp']as const)('%s canceled delete does not cross the real bridge and keeps last-good facts',async kind=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await mount(kind);fireEvent.click(deleteButton(kind));
 expect(confirm).toHaveBeenCalledTimes(1);expect(kind==='channels'?endpoint.deleteChannel:endpoint.deleteMCPInstall).not.toHaveBeenCalled();expect(screen.getByText(kind==='channels'?'Owned channel':'Owned MCP')).toBeInTheDocument();
});
it.each(['channels','mcp']as const)('%s confirmed delete routes original id and only refreshes after ACK',async kind=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const remove=kind==='channels'?endpoint.deleteChannel:endpoint.deleteMCPInstall;remove.mockResolvedValue(undefined);await mount(kind);fireEvent.click(deleteButton(kind));
 await waitFor(()=>expect(remove).toHaveBeenCalledExactlyOnceWith('owned'));await waitFor(()=>expect(kind==='channels'?endpoint.listChannels:endpoint.listMCPInstalls).toHaveBeenCalledTimes(2));
});
it.each(['channels','mcp']as const)('%s rejected delete preserves last-good and shows localized failure without secret echo',async kind=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const alert=vi.spyOn(window,'alert').mockImplementation(()=>{}),remove=kind==='channels'?endpoint.deleteChannel:endpoint.deleteMCPInstall;remove.mockRejectedValue(Error('OWNED_PRIVATE_SECRET'));await mount(kind);fireEvent.click(deleteButton(kind));
 await waitFor(()=>expect(alert).toHaveBeenCalledExactlyOnceWith(kind==='channels'?'通道操作失败，请重试':'MCP 配置操作失败，请重试'));expect(screen.getByText(kind==='channels'?'Owned channel':'Owned MCP')).toBeInTheDocument();expect(kind==='channels'?endpoint.listChannels:endpoint.listMCPInstalls).toHaveBeenCalledTimes(1);
});
it('test rejection crosses the actual bridge, stays independent of readonly retry, and never echoes secrets',async()=>{
 endpoint.testChannel.mockRejectedValue(Error('OWNED_PRIVATE_SECRET'));await mount('channels');fireEvent.click(screen.getByRole('button',{name:'测试'}));expect(await screen.findByText('连接失败')).toBeInTheDocument();expect(screen.queryByText('OWNED_PRIVATE_SECRET')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await waitFor(()=>expect(endpoint.listChannels).toHaveBeenCalledTimes(2));expect(screen.getByText('连接失败')).toBeInTheDocument();expect(endpoint.testChannel).toHaveBeenCalledExactlyOnceWith('owned');
});
