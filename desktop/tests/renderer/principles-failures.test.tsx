import {ImportMemoryModal} from '../../renderer/src/components/projects/ImportMemoryModal';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';import {PrinciplesTab} from '../../renderer/src/components/projects/PrinciplesTab';import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
const methods={list:vi.fn(),save:vi.fn(),remove:vi.fn()};const row={id:'own',content:'Own stored knowledge',scenarios:['planning'],source:'manual',enabled:true,createdAt:1,updatedAt:1};
beforeEach(()=>{methods.list.mockReset().mockResolvedValue([row]);methods.save.mockReset().mockRejectedValue(Error('principles_operation_unknown'));methods.remove.mockReset().mockRejectedValue(Error('principles_operation_unknown'));Object.defineProperty(window,'xiaokDesktop',{configurable:true,value:{listPrinciples:methods.list,savePrinciple:methods.save,deletePrinciple:methods.remove,kswarmProxyGet:async()=>null}});});afterEach(()=>{cleanup();delete (window as unknown as {xiaokDesktop?:unknown}).xiaokDesktop;});
it('shows localized list failure with an explicit read refresh instead of fake empty success',async()=>{methods.list.mockRejectedValueOnce(Error('principles_projection_unavailable'));render(<LocaleProvider><PrinciplesTab/></LocaleProvider>);await screen.findByText('原则列表暂时无法读取，请刷新重试。');expect(screen.queryByText('还没有知识与规则')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'刷新原则列表'}));await screen.findByText('Own stored knowledge');expect(methods.list).toHaveBeenCalledTimes(2);expect(methods.save).not.toHaveBeenCalled();});
it('keeps the edit modal and localizes uncertain save without automatic mutation retry',async()=>{render(<LocaleProvider><PrinciplesTab/></LocaleProvider>);await screen.findByText('Own stored knowledge');fireEvent.click(screen.getByTitle('编辑'));const modal=await screen.findByTestId('knowledge-rule-modal');fireEvent.click(screen.getByRole('button',{name:'保存'}));await screen.findByText('原则操作结果未确认，请刷新后检查。');expect(modal.isConnected).toBe(true);expect(methods.save).toHaveBeenCalledTimes(1);});

it('retains delete confirmation and saved knowledge when a delete reply is unsuccessful',async()=>{methods.remove.mockResolvedValue({success:false});render(<LocaleProvider><PrinciplesTab/></LocaleProvider>);await screen.findByText('Own stored knowledge');fireEvent.click(screen.getByTitle('删除'));const dialog=screen.getByText('确认删除').parentElement!;fireEvent.click(within(dialog).getByRole('button',{name:'删除'}));await screen.findByText('原则操作结果未确认，请刷新后检查。');expect(screen.getByText('确认删除')).toBeTruthy();expect(screen.getByText('Own stored knowledge')).toBeTruthy();expect(methods.remove).toHaveBeenCalledTimes(1);});

it('keeps memory import open and visibly reports callback failure without replaying import',async()=>{Object.defineProperty(window,'xiaokDesktop',{configurable:true,value:{listMemories:async()=>[{id:'own-memory',content:'Own import evidence'}]}});const close=vi.fn(),importEntries=vi.fn().mockRejectedValue(Error('原则操作结果未确认，请刷新后检查。'));render(<LocaleProvider><ImportMemoryModal open onClose={close} onImport={importEntries}/></LocaleProvider>);await screen.findByText('Own import evidence');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'导入选中项'}));await screen.findByText('原则操作结果未确认，请刷新后检查。');expect(close).not.toHaveBeenCalled();expect(importEntries).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'导入选中项'})).toBeTruthy();});

it.each(['edit','import'])('keeps an explicitly opened %s modal when the initial read fails asynchronously',async mode=>{
  let rejectRead!: (error: Error) => void;
  methods.list.mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRead=reject;}));
  render(<LocaleProvider><PrinciplesTab addTrigger={mode==='edit'?1:0} importTrigger={mode==='import'?1:0}/></LocaleProvider>);
  const opened=mode==='edit'?await screen.findByTestId('knowledge-rule-modal'):await screen.findByRole('heading',{name:'从 Memory 导入'});
  const draft=mode==='edit'?opened.querySelector('textarea'):null;
  if(draft)fireEvent.change(draft,{target:{value:'Own unfinished draft'}});
  rejectRead(Error('principles_projection_unavailable'));
  await screen.findByText('原则列表暂时无法读取，请刷新重试。');
  expect(opened.isConnected).toBe(true);if(draft)expect(draft.value).toBe('Own unfinished draft');
  expect(methods.save).not.toHaveBeenCalled();
});

it.each(['late-success','refresh-success'])('preserves the same edit modal and draft after %s returns records',async mode=>{
  let resolveRead!: (records: typeof row[]) => void;
  if(mode==='late-success')methods.list.mockImplementation(()=>new Promise(resolve=>{resolveRead=resolve;}));
  else methods.list.mockRejectedValueOnce(Error('principles_projection_unavailable')).mockResolvedValue([row]);
  render(<LocaleProvider><PrinciplesTab addTrigger={1}/></LocaleProvider>);
  const opened=await screen.findByTestId('knowledge-rule-modal');const draft=opened.querySelector('textarea')!;
  fireEvent.change(draft,{target:{value:'Own draft before records'}});
  if(mode==='late-success')resolveRead([row]);
  else {await screen.findByText('原则列表暂时无法读取，请刷新重试。');fireEvent.click(screen.getByRole('button',{name:'刷新原则列表'}));}
  await screen.findByText('Own stored knowledge');
  expect(opened.isConnected).toBe(true);expect(draft.value).toBe('Own draft before records');expect(methods.save).not.toHaveBeenCalled();
});
