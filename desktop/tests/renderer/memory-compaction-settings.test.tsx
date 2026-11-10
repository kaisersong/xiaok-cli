import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';import {describe,it,expect,vi,afterEach} from 'vitest';import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';import {MemoryCompactionSettings} from '../../renderer/src/components/settings/MemoryCompactionSettings';
const memory=vi.hoisted(()=>({getSettings:vi.fn(async()=>({version:1,embeddingModelId:'bge-small-zh-v1.5',compactionModelId:'deepseek-chat',resolvedCompactionModelId:'deepseek-chat',compactionModels:[{id:'deepseek-chat',label:'deepseek-chat',eligible:true,reason:null,source:'config_declared',contextLimit:null,quality:'not_evaluated'},{id:'gpt-4o-mini',label:'gpt-4o-mini',eligible:true,reason:null,source:'config_declared',contextLimit:null,quality:'not_evaluated'}],warning:null})),setModelId:vi.fn(async(id)=>{memory.getSettings.mockResolvedValue({...await memory.getSettings(),compactionModelId:id});return true})}));vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({memory})}));afterEach(()=>{cleanup();vi.clearAllMocks()});
describe('compression model card and menus',()=>{it('restores current value and saves new single selection via existing API',async()=>{render(<LocaleProvider><MemoryCompactionSettings/></LocaleProvider>);await screen.findByText('deepseek-chat');fireEvent.click(screen.getByRole('button',{name:'更换模型：压缩模型'}));expect(screen.getByRole('menuitemradio',{name:'deepseek-chat'})).toHaveAttribute('aria-checked','true');fireEvent.click(screen.getByRole('menuitemradio',{name:'gpt-4o-mini'}));await waitFor(()=>expect(memory.setModelId).toHaveBeenCalledWith('gpt-4o-mini'));await screen.findByText('gpt-4o-mini');fireEvent.click(screen.getByRole('button',{name:'更多操作：压缩模型'}));expect(screen.getByRole('menuitemradio',{name:'gpt-4o-mini'})).toBeDisabled();expect(memory.setModelId).toHaveBeenCalledTimes(1);});});
it('disables unknown choices in both menus, explains capability and quality, and preserves the old selection', async () => {
  memory.getSettings.mockResolvedValue({ version: 1, embeddingModelId: 'bge-small-zh-v1.5', compactionModelId: 'unknown', resolvedCompactionModelId: null,
    defaultCompactionModel: { id: 'unknown', label: 'Unknown', eligible: false, reason: 'unknown_capability', source: null, contextLimit: null, quality: 'not_evaluated' },
    compactionModels: [{ id: 'unknown', label: 'Unknown', eligible: false, reason: 'unknown_capability', source: null, contextLimit: null, quality: 'not_evaluated' },
      { id: 'valid', label: 'Valid multimodal', eligible: true, reason: null, source: 'config_declared', contextLimit: null, quality: 'not_evaluated' }], warning: 'invalid_model' } as never);
  render(<LocaleProvider><MemoryCompactionSettings/></LocaleProvider>);
  await screen.findByText(/原值已保留/);
  expect(screen.queryByText(/关键事实、时间、人物关系和约束/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '压缩模型选择说明' }));
  expect(screen.getByRole('dialog', { name: '压缩模型选择说明' })).toBeVisible();
  expect(screen.getByText(/关键事实、时间、人物关系和约束/)).toBeVisible();
  expect(screen.getByText(/未验证记忆压缩质量/)).toBeVisible();
  expect(screen.getByText(/请查供应商模型文档，确认文本输出后/)).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '压缩模型选择说明' })).toHaveFocus();
  for (const label of ['更换模型：压缩模型', '更多操作：压缩模型']) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('menuitemradio', { name: /Unknown/ })).toBeDisabled();
    expect(screen.getByRole('menuitemradio', { name: /默认（主模型）/ })).toBeDisabled();
    expect(screen.getByRole('menuitemradio', { name: /Valid multimodal/ })).not.toBeDisabled();
    expect(screen.getAllByText(/文本生成能力未知/).length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  }
  expect(memory.setModelId).not.toHaveBeenCalled();
});

it('help supports keyboard, outside click and hiding the configuration panel', async () => {
  const view = render(<LocaleProvider><MemoryCompactionSettings/></LocaleProvider>);
  const info = await screen.findByRole('button', { name: '压缩模型选择说明' });
  fireEvent.click(info);
  const dialog = screen.getByRole('dialog', { name: '压缩模型选择说明' });
  const close = screen.getByRole('button', { name: '关闭说明' });
  expect(close).toHaveFocus(); fireEvent.keyDown(dialog, { key: 'Tab' }); expect(close).toHaveFocus();
  fireEvent.click(dialog.parentElement!.parentElement!.parentElement!);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(info).toHaveFocus();
  fireEvent.click(info);
  view.rerender(<LocaleProvider><MemoryCompactionSettings active={false}/></LocaleProvider>);
  expect(screen.queryByRole('dialog')).toBeNull();
});
