import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryCompactionModelSettings} from '../../renderer/src/components/settings/MemoryCompactionModelSettings';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
const state=vi.hoisted(()=>({modelId:'deepseek' as string|null,api:{memory:{getSettings:vi.fn(),setModelId:vi.fn()}}}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.api}));
afterEach(()=>cleanup());
beforeEach(()=>{vi.clearAllMocks();state.modelId='deepseek';state.api.memory.getSettings.mockImplementation(async()=>({version:1,compactionModelId:state.modelId,warning:null,defaultCompactionModel:{eligible:true},compactionModels:[{id:'deepseek',label:'DeepSeek',eligible:true},{id:'glm',label:'GLM',eligible:true}]}));state.api.memory.setModelId.mockImplementation(async(id)=>{state.modelId=id;return true})});
it('loads the saved choice and preserves it after unmount and reopen',async()=>{
 const first=render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);await screen.findByText('DeepSeek');
 fireEvent.click(screen.getByRole('button',{name:'更换模型：压缩模型'}));expect(screen.getByRole('menuitemradio',{name:'DeepSeek'})).toHaveAttribute('aria-checked','true');
 fireEvent.click(screen.getByRole('menuitemradio',{name:'GLM'}));await waitFor(()=>expect(state.api.memory.setModelId).toHaveBeenCalledWith('glm'));
 first.unmount();render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);await screen.findByText('GLM');
 fireEvent.click(screen.getByRole('button',{name:'更换模型：压缩模型'}));expect(screen.getByRole('menuitemradio',{name:'GLM'})).toHaveAttribute('aria-checked','true');
});
it('keeps the existing selection when main rejects a save',async()=>{
 state.api.memory.setModelId.mockResolvedValueOnce(false);render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);await screen.findByText('DeepSeek');
 fireEvent.click(screen.getByRole('button',{name:'更换模型：压缩模型'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'GLM'}));expect(await screen.findByRole('alert')).toBeInTheDocument();
 expect(screen.getByText('DeepSeek')).toBeInTheDocument();expect(state.modelId).toBe('deepseek');
});
