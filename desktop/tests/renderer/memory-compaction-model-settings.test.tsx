import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryCompactionModelSettings} from '../../renderer/src/components/settings/MemoryCompactionModelSettings';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
const state=vi.hoisted(()=>({modelId:'deepseek' as string|null,api:{memory:{getModelId:vi.fn(),setModelId:vi.fn()},getModelConfig:vi.fn()}}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>state.api}));
afterEach(()=>cleanup());
beforeEach(()=>{vi.clearAllMocks();state.modelId='deepseek';state.api.memory.getModelId.mockImplementation(async()=>state.modelId);state.api.memory.setModelId.mockImplementation(async(id)=>{state.modelId=id;return true});state.api.getModelConfig.mockResolvedValue({models:[{id:'deepseek',label:'DeepSeek'},{id:'glm',label:'GLM'}]})});
it('loads the saved choice and preserves it after unmount and reopen',async()=>{
 const first=render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('deepseek'));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'glm'}});
 await waitFor(()=>expect(state.api.memory.setModelId).toHaveBeenCalledWith('glm'));
 first.unmount();render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('glm'));
});
it('keeps the existing selection when main rejects a save',async()=>{
 state.api.memory.setModelId.mockResolvedValueOnce(false);render(<LocaleProvider><MemoryCompactionModelSettings/></LocaleProvider>);
 await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('deepseek'));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'glm'}});
 expect(await screen.findByRole('alert')).toBeInTheDocument();
 expect(screen.getByRole('combobox')).toHaveValue('deepseek');
});
