import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryModelSettings } from '../../renderer/src/components/settings/MemoryModelSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const model = (active = true, downloaded = true) => ({id:'bge-small-zh-v1.5',name:'BGE 中文',dims:512,size:'95MB',languages:'中文',downloaded,active,manualHint:{urls:[],targetDir:'/tmp/models'}});
const original = window.xiaokDesktop;
afterEach(() => { cleanup(); window.xiaokDesktop = original; });
it('shows the saved default independently of download availability', async () => {
  window.xiaokDesktop = { getEmbeddingModels: vi.fn().mockResolvedValue([model()]) } as any;
  render(<LocaleProvider><MemoryModelSettings /></LocaleProvider>);
  expect(await screen.findByRole('button',{name:'BGE 中文'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText('当前配置')).toBeInTheDocument();
  expect(screen.getByText('已下载')).toBeInTheDocument();
});
it('allows downloading the configured model when its files are missing', async () => {
  const get = vi.fn().mockResolvedValueOnce([model(true,false)]).mockResolvedValue([model()]);
  const download=vi.fn().mockResolvedValue(undefined), select=vi.fn().mockResolvedValue(undefined);
  window.xiaokDesktop={getEmbeddingModels:get,downloadEmbeddingModel:download,setEmbeddingModel:select} as any;
  render(<LocaleProvider><MemoryModelSettings /></LocaleProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'BGE 中文'}));
  fireEvent.click(await screen.findByRole('button',{name:'确定'}));
  await waitFor(()=> expect(download).toHaveBeenCalledWith('bge-small-zh-v1.5'));
  await waitFor(()=> expect(select).toHaveBeenCalledWith('bge-small-zh-v1.5'));
  expect(await screen.findByText('当前配置')).toBeInTheDocument();
});
