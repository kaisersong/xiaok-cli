import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {McpWorkControls} from '../../renderer/src/components/McpWorkControls';
const mock=vi.hoisted(()=>({inputs:vi.fn(),answer:vi.fn(),cancel:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({getMcpTaskInputs:mock.inputs,answerMcpTaskInput:mock.answer,cancelMcpWork:mock.cancel})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const form={inputId:'question',expectedDigest:'digest',prompt:'<img src=x onerror=alert(1)>选择格式',fields:[{key:'format',title:'格式',type:'choice',required:true,options:['html','pdf']}]};
describe('rendered pending MCP input controls',()=>{
 it('keeps the input pending without any automatic answer, escapes its text, and submits only the user choice',async()=>{
  mock.inputs.mockResolvedValue([form]);mock.answer.mockResolvedValue(undefined);
  const {container}=render(<LocaleProvider><textarea aria-label="draft" defaultValue={'中文\n草稿'}/><McpWorkControls watchId="watch" needsInput revision={1}/></LocaleProvider>);
  const draft=screen.getByLabelText('draft');draft.focus();
  await waitFor(()=>expect(screen.getByRole('combobox')).toBeVisible());
  expect(draft).toHaveFocus();expect(draft).toHaveValue('中文\n草稿');expect(container.querySelector('img')).toBeNull();expect(mock.answer).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'pdf'}});fireEvent.submit(screen.getByRole('combobox').closest('form')!);
  await waitFor(()=>expect(mock.answer).toHaveBeenCalledWith({watchId:'watch',inputId:'question',expectedDigest:'digest',action:'accept',content:{format:'pdf'}}));
  expect(draft).toHaveValue('中文\n草稿');
 });
 it('leaves the source outcome unchanged after a cancellation request receipt',async()=>{
  mock.inputs.mockResolvedValue([]);mock.cancel.mockResolvedValue({requested:true});
  render(<LocaleProvider><McpWorkControls watchId="watch" needsInput={false} revision={1}/></LocaleProvider>);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(()=>expect(mock.cancel).toHaveBeenCalledWith('watch'));
  expect(screen.getByRole('button')).toBeDisabled();expect(screen.getByRole('button')).toHaveTextContent(/请求|Requested/i);
 });
});
