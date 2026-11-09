import {it,expect,vi,afterEach} from 'vitest';import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';import {AssistantPeriodicSettings} from '../../renderer/src/components/assistant/AssistantPeriodicSettings';
const status={revision:0,enabled:false,notificationsEnabled:false,intervalMinutes:240,quietHours:{start:'22:00',end:'08:00'},available:false,reason:'quality_unverified' as const,notificationsAvailable:false};afterEach(cleanup);
it('keeps periodic analysis and notifications off until qualification is available',()=>{
 const save=vi.fn(),check=vi.fn();render(<LocaleProvider><AssistantPeriodicSettings status={status} busy={false} onSave={save} onCheck={check}/></LocaleProvider>);
 expect(screen.getByText('尚未完成真实质量评估，周期检查保持关闭。')).toBeTruthy();
 const switches=screen.getAllByRole('checkbox') as HTMLInputElement[];expect(switches.every(input=>!input.checked&&input.disabled)).toBe(true);expect(check).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('requires an explicit save and check, and never opts into OS notifications automatically',()=>{
 const save=vi.fn(),check=vi.fn();render(<LocaleProvider><AssistantPeriodicSettings status={{...status,available:true,reason:null,notificationsAvailable:true}} busy={false} onSave={save} onCheck={check}/></LocaleProvider>);
 fireEvent.click(screen.getByRole('checkbox',{name:'启用周期检查'}));expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存检查设置'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({enabled:true,notificationsEnabled:false,intervalMinutes:240,expectedRevision:0}));expect(check).not.toHaveBeenCalled();
});
