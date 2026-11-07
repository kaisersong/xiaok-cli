import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { compileRenderUiToA2ui, A2UI_MIME_TYPE } from '../../../src/a2ui';
import { A2uiInlineCard } from '../../renderer/src/components/a2ui/A2uiInlineCard';
const f = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../renderer/src/api', () => ({ api: { readFileContent: f.read } }));
vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <div /> }));
const artifact = { artifactId:'sales', sourceTaskId:'A', kind:'a2ui' as const, title:'sales.a2ui.json', filePath:'/tmp/sales.a2ui.json', mimeType:A2UI_MIME_TYPE, createdAt:'turn', previewAvailable:true };
function props(): ComponentProps<typeof ChatView> { return {
 thread:{id:'thread',title:'Analysis',status:'completed',mode:'work',createdAt:1,updatedAt:1,starred:false,gtdBucket:'inbox',pinnedAt:null,currentTaskId:'A',taskIds:['A']},
 messages:[],streamingText:'',status:'completed',currentQuestion:null,result:null,generatedFiles:[],prompt:'',onPromptChange:vi.fn(),onSubmit:vi.fn(),onAnswer:vi.fn(),onCancel:vi.fn(),canvasOpen:false,onToggleCanvas:vi.fn(),
}; }
function mount(extra: Partial<ComponentProps<typeof ChatView>>) { return render(<LocaleProvider><ChatView {...props()} {...extra}/></LocaleProvider>); }
beforeEach(()=>{Element.prototype.scrollIntoView=vi.fn();f.read.mockResolvedValue({content:JSON.stringify(compileRenderUiToA2ui({title:'Sales chart',sections:[{kind:'heading',text:'Sales chart'},{kind:'table',columns:['Department','Revenue'],rows:[['Sales',100],['Ops',120]]}]},{taskId:'A',toolUseId:'call'}).messages)});});
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('Inline generative UI conversation content',()=>{
 it('renders text, a recorded card and following text in order outside deliverables',async()=>{
  mount({messages:[{id:'before',role:'assistant',content:'Before chart.'},{id:'ui',role:'ui_card',content:'',uiCard:{artifact}},{id:'after',role:'assistant',content:'After chart.'}],result:{summary:'After chart.',artifacts:[artifact]}});
  const card=await screen.findByRole('heading',{name:'Sales chart'});
  expect(screen.getByText('Before chart.').compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.compareDocumentPosition(screen.getByText('After chart.'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.closest('[data-testid="task-result-card"]')).toBeNull();
  expect(screen.getAllByRole('heading',{name:'Sales chart'})).toHaveLength(1);
  expect(screen.queryByTestId('generated-file-sales.a2ui.json')).toBeNull();
 });
 it('preserves mixed file deliverables while displaying a legacy result-only UI as body content',async()=>{
  const pdf={...artifact,artifactId:'pdf',kind:'pdf' as const,title:'report.pdf',filePath:'/tmp/report.pdf',mimeType:'application/pdf'};
  mount({result:{summary:'A separate conclusion.',artifacts:[artifact,pdf]}});
  const card=await screen.findByRole('heading',{name:'Sales chart'});
  expect(card.closest('[data-testid="task-result-card"]')).toBeNull();
  expect(screen.getByTestId('generated-file-report.pdf')).toBeDefined();
  expect(screen.getByText('A separate conclusion.')).toBeDefined();
 });
 it('keeps file load errors visible at the inline card position',async()=>{
  f.read.mockResolvedValue({content:'',error:'denied'});
  mount({messages:[{id:'ui',role:'ui_card',content:'',uiCard:{artifact}}],result:{summary:'',artifacts:[artifact]}});
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.queryByTestId('task-result-card')).toBeNull();
 });
 it('ignores an old file read after the source identity changes',async()=>{
  let resolveOld!: (value: {content:string}) => void;
  f.read.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const view=render(<LocaleProvider><A2uiInlineCard artifact={artifact}/></LocaleProvider>);
  view.rerender(<LocaleProvider><A2uiInlineCard artifact={{...artifact,sourceTaskId:'B',artifactId:'new',filePath:'/tmp/new.a2ui.json'}}/></LocaleProvider>);
  expect(await screen.findByRole('heading',{name:'Sales chart'})).toBeDefined();
  await act(async()=>resolveOld({content:'invalid old source payload'}));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading',{name:'Sales chart'})).toBeDefined();
 });
 it('keeps agent file links referenced only before the inline card',async()=>{
  const pdf={...artifact,artifactId:'pdf',kind:'pdf' as const,title:'report.pdf',filePath:'/tmp/report.pdf',mimeType:'application/pdf',creator:'agent'};
  mount({messages:[{id:'before',role:'assistant',content:'Report: `/tmp/report.pdf`'},{id:'ui',role:'ui_card',content:'',uiCard:{artifact}},{id:'after',role:'assistant',content:'Done.'}],result:{summary:'Done.',artifacts:[artifact,pdf]}});
  expect(await screen.findByRole('heading',{name:'Sales chart'})).toBeDefined();
  expect(screen.getByTestId('generated-file-report.pdf')).toBeDefined();
 });
 it('deduplicates repeated legacy result references by source and artifact identity',async()=>{
  mount({result:{summary:'',artifacts:[artifact,{...artifact}]}});
  await screen.findByRole('heading',{name:'Sales chart'});
  expect(screen.getAllByRole('heading',{name:'Sales chart'})).toHaveLength(1);
  expect(f.read).toHaveBeenCalledTimes(1);
 });
});
