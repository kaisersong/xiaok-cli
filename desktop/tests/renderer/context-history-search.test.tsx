import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ContextHistorySearch } from '../../renderer/src/components/ContextHistorySearch';
const state=vi.hoisted(()=>({desktop:null as Record<string,unknown>|null}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.desktop}));
afterEach(()=>{cleanup();state.desktop=null;});
const view=(id:string)=><LocaleProvider><ContextHistorySearch conversationId={id}/></LocaleProvider>;
const hit={refId:'a'.repeat(32),url:`xiaok://context/v1/${'a'.repeat(32)}`,conversationId:'source',messageId:'m',revision:1,contentHash:'hash',sourceKind:'desktop_task',observedAt:1,executionState:'settled',title:'Source',excerpt:'HISTORY_UI_CANARY'};
it('performs user keyword search and leaves exact attachment to its separate explicit action',async()=>{
 const attachContextReference=vi.fn(async()=>({grantId:'grant'}));const searchContextHistory=vi.fn(async()=>({mode:'keyword',coverage:'canonical_only',scope:'private_history',hits:[hit]}));
 state.desktop={searchContextHistory,getHistorySearchConsent:vi.fn(async()=>({enabled:false,revision:0})),getContextGrant:vi.fn(async()=>null),attachContextReference,resolveContextReference:vi.fn()};
 render(view('target'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));
 fireEvent.change(screen.getByRole('textbox',{name:'历史关键词'}),{target:{value:'上下文'}});fireEvent.click(screen.getByRole('button',{name:'搜索'}));
 await screen.findByText('HISTORY_UI_CANARY');expect(searchContextHistory).toHaveBeenCalledWith({query:'上下文',limit:20});expect(attachContextReference).not.toHaveBeenCalled();
 expect(screen.getByText('在已采集的用户和助手消息中匹配关键词。')).toBeVisible();
 const attach=screen.getByRole('button',{name:'允许当前会话读取'});await waitFor(()=>expect(attach).toBeEnabled());fireEvent.click(attach);await waitFor(()=>expect(attachContextReference).toHaveBeenCalledTimes(1));
});
it('persists user consent only after a user toggle',async()=>{
 const setHistorySearchConsent=vi.fn(async()=>({enabled:true,revision:1}));
 state.desktop={searchContextHistory:vi.fn(),getHistorySearchConsent:vi.fn(async()=>({enabled:false,revision:0})),setHistorySearchConsent};
 render(view('target'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));
 const checkbox=await screen.findByRole('checkbox',{name:'允许本会话的 Agent 检索我的私人聊天历史'});await waitFor(()=>expect(checkbox).toBeEnabled());
 expect(setHistorySearchConsent).not.toHaveBeenCalled();fireEvent.click(checkbox);await waitFor(()=>expect(setHistorySearchConsent).toHaveBeenCalledWith({conversationId:'target',enabled:true}));
 expect(checkbox).toBeChecked();
});
it('discards an old conversation search after navigation while its response is pending',async()=>{
 let release!:(value:unknown)=>void;
 state.desktop={searchContextHistory:vi.fn(()=>new Promise(resolve=>{release=resolve;})),getHistorySearchConsent:vi.fn(async()=>({enabled:false,revision:0}))};
 const rendered=render(view('old'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));
 fireEvent.change(screen.getByRole('textbox',{name:'历史关键词'}),{target:{value:'old'}});fireEvent.click(screen.getByRole('button',{name:'搜索'}));
 await waitFor(()=>expect(release).toBeTypeOf('function'));rendered.rerender(view('new'));
 release({mode:'keyword',coverage:'canonical_only',scope:'private_history',hits:[hit]});await waitFor(()=>expect(screen.queryByText('HISTORY_UI_CANARY')).not.toBeInTheDocument());
});
it('clears old results on query edits and reports a failed search without stale evidence',async()=>{
 const searchContextHistory=vi.fn().mockResolvedValueOnce({mode:'keyword',coverage:'canonical_only',scope:'private_history',hits:[hit]}).mockRejectedValueOnce(new Error('not_readable'));
 state.desktop={searchContextHistory,getHistorySearchConsent:vi.fn(async()=>({enabled:false,revision:0})),getContextGrant:vi.fn(async()=>null)};
 render(view('target'));fireEvent.click(screen.getByRole('button',{name:'搜索聊天历史'}));const input=screen.getByRole('textbox',{name:'历史关键词'});
 fireEvent.change(input,{target:{value:'one'}});fireEvent.click(screen.getByRole('button',{name:'搜索'}));await screen.findByText('HISTORY_UI_CANARY');
 fireEvent.change(input,{target:{value:'two'}});expect(screen.queryByText('HISTORY_UI_CANARY')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'搜索'}));
 await screen.findByRole('alert');expect(screen.queryByText('HISTORY_UI_CANARY')).not.toBeInTheDocument();
});
