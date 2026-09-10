import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectAgentModelSelect } from '../../renderer/src/components/projects/ProjectAgentModelSelect';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
vi.mock('../../renderer/src/api',()=>({api:{getModelConfig:async()=>({defaultModelId:'text',models:[{id:'text',label:'Text model',capabilities:['tools']},{id:'vision',label:'Vision model',capabilities:['image_in']},{id:'local-codex',label:'Codex runtime',projectAgentSelectable:false}]})}}));
afterEach(cleanup);
describe('project agent configured model selector', () => {
 it('uses only an image icon for supported models and no capability prose', async () => {
  const change = vi.fn();
  render(<LocaleProvider><ProjectAgentModelSelect value="" onChange={change}/></LocaleProvider>);
  fireEvent.click(screen.getByLabelText('模型'));
  const vision = await screen.findByRole('button', { name: /Vision model/ });
  expect(within(vision).getByRole('img')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: 'Text model' })).queryByRole('img')).toBeNull();
  expect(screen.queryByText(/未声明图像/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Codex/ })).toBeNull();
  fireEvent.click(vision);
  expect(change).toHaveBeenCalledWith('vision');
 });
 it('retains removed selection and permits following current', async () => {
  const change = vi.fn();
  render(<LocaleProvider><ProjectAgentModelSelect value="removed" onChange={change}/></LocaleProvider>);
  expect(screen.getByLabelText('模型')).toHaveTextContent(/removed.*不可用/);
  fireEvent.click(screen.getByLabelText('模型'));
  fireEvent.click(await screen.findByRole('button', { name: /跟随小 K 当前模型/ }));
  expect(change).toHaveBeenCalledWith('');
 });
});
