import {it,expect,vi,afterEach} from 'vitest';import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {AssistantCalendar} from '../../renderer/src/components/assistant/AssistantCalendar';
afterEach(cleanup);
it('offers only connection settings, never event mutations',()=>{
 const connect=vi.fn(),disconnect=vi.fn();
 const view=render(<LocaleProvider><AssistantCalendar status={{enabled:false,epoch:0,lastCompleteWatermark:null,snapshot:{status:'disabled',epoch:0,collectedAt:null,from:null,to:null,errorCode:null,events:[]}}} onConnect={connect} onDisconnect={disconnect}/></LocaleProvider>);
 fireEvent.click(screen.getByRole('button'));expect(connect).toHaveBeenCalledOnce();
 view.rerender(<LocaleProvider><AssistantCalendar status={{enabled:true,epoch:1,lastCompleteWatermark:null,snapshot:{status:'partial',epoch:1,collectedAt:1,from:1,to:2,errorCode:'completeness_unknown',events:[]}}} onConnect={connect} onDisconnect={disconnect}/></LocaleProvider>);
 expect(screen.getByText(/覆盖不完整/)).toBeTruthy();fireEvent.click(screen.getByRole('button'));expect(disconnect).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:/创建|取消|邀请/})).toBeNull();
});
it('keeps calendar memory consent independent from connection and sends only enabled plus current revision',()=>{
 const configure=vi.fn();const status={enabled:false,epoch:0,lastCompleteWatermark:null,snapshot:{status:'disabled' as const,epoch:0,collectedAt:null,from:null,to:null,errorCode:null,events:[]}};
 const view=render(<LocaleProvider><AssistantCalendar status={status} memory={{enabled:false,revision:7}} onConfigureMemory={configure}/></LocaleProvider>);
 fireEvent.click(screen.getByText('云之家日历'));const toggle=screen.getByRole('checkbox',{name:'日历准备建议使用已确认记忆'});expect(toggle).not.toBeChecked();expect(screen.getByText(/仅召回已人工采纳且作用域匹配的记忆/)).toHaveTextContent(/不会自动将日历保存为长期记忆/);fireEvent.click(toggle);expect(configure).toHaveBeenCalledExactlyOnceWith({enabled:true,expectedRevision:7});expect(toggle).not.toBeChecked();
 view.rerender(<LocaleProvider><AssistantCalendar status={status} memory={{enabled:true,revision:8}} onConfigureMemory={configure}/></LocaleProvider>);expect(screen.getByRole('checkbox')).toBeChecked();fireEvent.click(screen.getByRole('checkbox'));expect(configure).toHaveBeenLastCalledWith({enabled:false,expectedRevision:8});
 view.rerender(<LocaleProvider><AssistantCalendar status={status} memory={{enabled:false,revision:9}} busy onConfigureMemory={configure}/></LocaleProvider>);expect(screen.getByRole('checkbox')).toBeDisabled();
});
it('does not infer memory consent from a connected calendar or expose it without settings',()=>{render(<LocaleProvider><AssistantCalendar status={{enabled:true,epoch:1,lastCompleteWatermark:null,snapshot:{status:'partial',epoch:1,collectedAt:1,from:1,to:2,errorCode:null,events:[]}}}/></LocaleProvider>);expect(screen.queryByRole('checkbox')).toBeNull()});
it('explains confirmed-memory recall accurately in English without promising calendar memory writes',()=>{const previous=localStorage.getItem('xiaok:locale');localStorage.setItem('xiaok:locale','en');try{render(<LocaleProvider><AssistantCalendar memory={{enabled:false,revision:0}} onConfigureMemory={()=>{}}/></LocaleProvider>);fireEvent.click(screen.getByText('Yunzhijia calendar'));expect(screen.getByRole('checkbox',{name:'Use confirmed memories for calendar preparation suggestions'})).not.toBeChecked();expect(screen.getByText(/Only recalls memories explicitly accepted by you and matching the current scope/)).toHaveTextContent(/not automatically saved to long-term memory/);expect(screen.getByText(/Turning it off stops recall and hides results/)).toBeVisible();}finally{if(previous===null)localStorage.removeItem('xiaok:locale');else localStorage.setItem('xiaok:locale',previous)}});
