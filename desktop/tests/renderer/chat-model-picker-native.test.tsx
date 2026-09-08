import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { ChatModelPicker } from '../../renderer/src/components/ChatModelPicker';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const config={defaultModelId:'remote',providers:[{id:'remote',label:'Remote'},{id:'local-codex',label:'Codex'}],models:[{id:'remote',provider:'remote',label:'Remote Model'},{id:'local-codex',provider:'local-codex',label:'Codex'}]};
const save=vi.fn(async()=>({...config,defaultModelId:'local-codex'}));
vi.mock('../../renderer/src/api',()=>({api:{getModelConfig:async()=>config,saveModelConfig:(...args:any[])=>save(...args)}}));
it('selects Local Codex through the same model picker without navigation',async()=>{
 render(<LocaleProvider><ChatModelPicker/></LocaleProvider>);await screen.findByText('Remote Model');fireEvent.click(screen.getByRole('button'));fireEvent.click(await screen.findByText('本地 Codex'));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({providerId:'local-codex',modelId:'local-codex'}));await screen.findByText('本地 Codex');expect(screen.queryByText('选择目录并新建')).toBeNull();
});
