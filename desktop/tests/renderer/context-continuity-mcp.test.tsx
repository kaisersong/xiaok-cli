import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ContextMcpAccess } from '../../renderer/src/components/ContextMcpAccess';
const state=vi.hoisted(()=>({desktop:null as Record<string,unknown>|null}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.desktop}));
afterEach(()=>{cleanup();state.desktop=null;vi.unstubAllGlobals();});
it('requires an explicit issue action and keeps one-time credentials out of the chat and browser storage',async()=>{
 const issue=vi.fn(async()=>({credentialId:'credential',clientConfig:'{"Authorization":"Bearer one-time-secret"}'})),writeText=vi.fn(async()=>{});
 state.desktop={getContextMcpStatus:vi.fn(async()=>({enabled:false,state:'disabled',url:null})),listExternalContextReaders:vi.fn(async()=>[]),issueContextMcpConfig:issue};
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 const storage=vi.spyOn(Storage.prototype,'setItem');
 const view=render(<LocaleProvider><ContextMcpAccess refId={'a'.repeat(32)} targetConversationId="target" allowed /></LocaleProvider>);
 expect(issue).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'连接外部 Agent'}));await screen.findByRole('button',{name:'生成一次性 MCP 配置'});expect(issue).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'生成一次性 MCP 配置'}));const config=await screen.findByRole('textbox',{name:'一次性 MCP 配置'});expect(config).toHaveValue('{"Authorization":"Bearer one-time-secret"}');
 expect(issue).toHaveBeenCalledWith({operationId:expect.any(String),targetConversationId:'target',refIds:['a'.repeat(32)]});expect(writeText).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'复制 MCP 配置'}));await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));
 expect(storage.mock.calls.some(call=>String(call[1]).includes('one-time-secret'))).toBe(false);storage.mockRestore();
 view.rerender(<LocaleProvider><ContextMcpAccess refId={'a'.repeat(32)} targetConversationId="target" allowed={false} /></LocaleProvider>);
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'一次性 MCP 配置'})).toBeNull());
});
it('does not issue credentials without a live explicit grant and supports revoking a previously issued credential',async()=>{
 const revoke=vi.fn(async()=>{}),issue=vi.fn();
 state.desktop={getContextMcpStatus:vi.fn(async()=>({enabled:true,state:'listening',url:'http://127.0.0.1:12345/mcp'})),listExternalContextReaders:vi.fn(async()=>[{credentialId:'credential',targetConversationId:'target',refIds:['a'.repeat(32)],revoked:false}]),issueContextMcpConfig:issue,revokeExternalContextReader:revoke};
 render(<LocaleProvider><ContextMcpAccess refId={'a'.repeat(32)} targetConversationId="target" allowed={false} /></LocaleProvider>);
 fireEvent.click(screen.getByRole('button',{name:'连接外部 Agent'}));expect(await screen.findByRole('button',{name:'生成一次性 MCP 配置'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'撤销外部读取凭证'}));await waitFor(()=>expect(revoke).toHaveBeenCalledWith({credentialId:'credential'}));expect(issue).not.toHaveBeenCalled();
});
