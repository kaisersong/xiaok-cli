import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';import {MemoryModelSettings} from '../../renderer/src/components/settings/MemoryModelSettings';
const mocks=vi.hoisted(()=>({list:vi.fn(),download:vi.fn(),set:vi.fn(),remove:vi.fn()}));const models=[{id:'a',name:'synthetic A',dims:384,size:'1 MB',languages:'synthetic',downloaded:true,active:true,manualHint:{urls:[{file:'weights',url:'https://example.com/public'}],targetDir:'fixture'}},{id:'b',name:'synthetic B',dims:512,size:'2 MB',languages:'synthetic',downloaded:false,active:false,manualHint:{urls:[],targetDir:'fixture'}}];const mount=()=>render(<LocaleProvider><MemoryModelSettings/></LocaleProvider>);
beforeEach(()=>{Object.assign(window,{xiaokDesktop:{getEmbeddingModels:mocks.list,downloadEmbeddingModel:mocks.download,setEmbeddingModel:mocks.set,deleteEmbeddingModel:mocks.remove}});mocks.list.mockResolvedValue(models);mocks.set.mockResolvedValue(undefined)});afterEach(()=>{cleanup();vi.resetAllMocks()});
describe('embedding cards use consistent model actions',()=>{
 it('shows current selection and menu guide without implicit download',async()=>{mount();await screen.findByText('synthetic A');expect(screen.getByText('当前选择')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'synthetic A：手动下载指引'}));expect(screen.getByText('fixture')).toBeInTheDocument();expect(mocks.download).not.toHaveBeenCalled();});
 it('confirmation cancel does not download; repeated confirm stays serialized',async()=>{let done!:()=>void;mocks.download.mockImplementation(()=>new Promise<void>(r=>{done=r}));mount();await screen.findByText('synthetic B');fireEvent.click(screen.getByRole('button',{name:'下载并切换'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'取消'}));expect(mocks.download).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'下载并切换'}));const confirm=within(screen.getByRole('dialog')).getByRole('button',{name:'确认'});fireEvent.click(confirm);fireEvent.click(confirm);await waitFor(()=>expect(mocks.download).toHaveBeenCalledTimes(1));expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');done();await waitFor(()=>expect(mocks.set).toHaveBeenCalledWith('b'));});
 it('failure enables retry without printing raw backend error',async()=>{mocks.download.mockRejectedValue(new Error('private-backend-query'));mount();await screen.findByText('synthetic B');fireEvent.click(screen.getByRole('button',{name:'下载并切换'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认'}));await screen.findByRole('alert');expect(screen.queryByText(/private-backend-query/)).toBeNull();expect(mocks.set).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'重试'})).not.toBeDisabled();});
 it('downloaded model switches only after confirmation and reflects the one main selection',async()=>{mocks.list.mockResolvedValue(models.map(m=>({...m,downloaded:true})));mocks.set.mockImplementation(async()=>{mocks.list.mockResolvedValue(models.map(m=>({...m,downloaded:true,active:m.id==='b'})))});mount();await screen.findByText('synthetic B');const b=screen.getByRole('article',{name:'synthetic B'});fireEvent.click(within(b).getByRole('button',{name:'使用模型'}));expect(mocks.set).not.toHaveBeenCalled();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认'}));await waitFor(()=>expect(within(b).getByText('当前选择')).toBeInTheDocument());expect(screen.getAllByText('当前选择')).toHaveLength(1);expect(mocks.download).not.toHaveBeenCalled();});
});

it('keeps static embedding help behind the consistent information button', async () => {
  mount(); await screen.findByText('synthetic A');
  expect(screen.queryByText(/选择用于记忆检索的本地向量化模型/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '向量模型与下载说明' }));
  expect(screen.getByRole('dialog', { name: '向量模型与下载说明' })).toBeVisible();
  expect(screen.getByText(/选择用于记忆检索的本地向量化模型/)).toBeVisible();
  expect(within(screen.getByRole('dialog')).getByText(/下载并切换/)).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});

it('model-specific help replaces the menu guide; active removal is disabled', async () => {
 mount(); await screen.findByText('synthetic A');
 fireEvent.click(screen.getByRole('button', { name: 'synthetic A：手动下载指引' }));
 expect(screen.getByRole('dialog', { name: 'synthetic A：手动下载指引' })).toBeVisible();
 expect(screen.getByText('fixture')).toBeVisible(); fireEvent.keyDown(document, { key: 'Escape' });
 fireEvent.click(screen.getByRole('button', { name: '更多操作：synthetic A' }));
 expect(screen.queryByRole('menuitem', { name: '手动下载指引' })).toBeNull();
 expect(screen.getByRole('menuitem', { name: '删除模型' })).toBeDisabled();
 expect(screen.getByText(/先切换到其他向量模型/)).toBeVisible();
 expect(mocks.remove).not.toHaveBeenCalled();
});
it('removes an inactive model only after confirmation and refreshes the list', async () => {
 mocks.list.mockResolvedValue(models.map(m=>({...m,downloaded:true})));
 mocks.remove.mockImplementation(async()=>{mocks.list.mockResolvedValue(models);});
 mount(); await screen.findByText('synthetic B');
 fireEvent.click(screen.getByRole('button', { name: '更多操作：synthetic B' }));fireEvent.click(screen.getByRole('menuitem', { name: '删除模型' }));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));expect(mocks.remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: '更多操作：synthetic B' }));fireEvent.click(screen.getByRole('menuitem', { name: '删除模型' }));
 expect(screen.getByText(/保留记忆、配置和其他模型/)).toBeVisible();
 const confirm=within(screen.getByRole('dialog')).getByRole('button', { name: '确认' });fireEvent.click(confirm);fireEvent.click(confirm);
 await waitFor(()=>expect(mocks.remove).toHaveBeenCalledTimes(1));expect(mocks.remove).toHaveBeenCalledWith('b');
 await waitFor(()=>expect(within(screen.getByRole('article', {name:'synthetic B'})).getByText('未安装')).toBeVisible());
 expect(mocks.set).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
});
it('keeps deletion errors visible without leaking backend text and allows retry', async () => {
 mocks.list.mockResolvedValue(models.map(m=>({...m,downloaded:true})));mocks.remove.mockRejectedValue(new Error('private-backend-path'));
 mount();await screen.findByText('synthetic B');fireEvent.click(screen.getByRole('button',{name:'更多操作：synthetic B'}));fireEvent.click(screen.getByRole('menuitem',{name:'删除模型'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'确认'}));
 await screen.findByRole('alert');expect(screen.queryByText(/private-backend-path/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'更多操作：synthetic B'}));expect(screen.getByRole('menuitem',{name:'删除模型'})).not.toBeDisabled();
});
