import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { zh } from '../../renderer/src/locales/zh';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { LocalMemoryStatsCard } from '../../renderer/src/components/settings/LocalMemoryStatsCard';
const memory=vi.hoisted(()=>({stats:vi.fn(async()=>({l0:1,l1:0,l2:0,l3:0,dbSizeBytes:0})),listLayer:vi.fn(async()=>[]),getSettings:vi.fn(async()=>({resolvedCompactionModelId:'synthetic-model',warning:null})),compact:vi.fn(),cancelCompaction:vi.fn(async()=>true)}));
const api=vi.hoisted(()=>({memory}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>api}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
describe('manual compaction result and disclosure',()=>{
 it('asks before inference, reports failure accurately and never displays successful completion',async()=>{
  memory.compact.mockRejectedValue(Error('private credential detail'));render(<LocaleProvider><LocalMemoryStatsCard/></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button',{name:zh.desktopSettings.memoryCompact}));const dialog=await screen.findByRole('presentation');
  expect(within(dialog).getByText(/synthetic-model/)).toHaveTextContent('发送');expect(memory.compact).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:zh.desktopSettings.memoryCompact}));expect(await screen.findByRole('alert')).toHaveTextContent('失败');expect(screen.queryByRole('button',{name:zh.desktopSettings.memoryCompactDone})).toBeNull();expect(screen.queryByText(/private credential detail/)).toBeNull();
  expect(memory.compact).toHaveBeenCalledWith({expectedModelId:'synthetic-model'});
 });
 it('requests cancellation but keeps the original job pending until it actually settles',async()=>{
  let reject!:(reason:unknown)=>void;memory.compact.mockImplementation(()=>new Promise((_resolve,r)=>{reject=r}));render(<LocaleProvider><LocalMemoryStatsCard/></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button',{name:zh.desktopSettings.memoryCompact}));fireEvent.click(within(await screen.findByRole('presentation')).getByRole('button',{name:zh.desktopSettings.memoryCompact}));
  fireEvent.click(await screen.findByRole('button',{name:'取消记忆压缩'}));await waitFor(()=>expect(memory.cancelCompaction).toHaveBeenCalledOnce());
  expect(screen.getByRole('button',{name:zh.desktopSettings.memoryCompact})).toBeDisabled();expect(await screen.findByRole('button',{name:'已请求取消，等待当前任务结束'})).toBeDisabled();
  await act(async()=>reject(new DOMException('cancelled','AbortError')));expect(screen.getByRole('button',{name:zh.desktopSettings.memoryCompact})).toBeEnabled();expect(screen.queryByRole('button',{name:zh.desktopSettings.memoryCompactDone})).toBeNull();
 });
});
