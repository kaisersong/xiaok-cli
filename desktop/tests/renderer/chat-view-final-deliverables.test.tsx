import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatView, type ChatMessage, type GeneratedFile } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { ArtifactSummary, TaskResult } from '../../shared/task-types';

vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <div /> }));
afterEach(cleanup);

function artifact(filePath: string, creator: string | undefined = 'agent'): ArtifactSummary {
  return { artifactId: filePath, filePath, title: filePath.split(/[\\/]/).pop()!, creator,
    kind: filePath.endsWith('.pdf') ? 'pdf' : 'other', createdAt: 'turn', previewAvailable: true };
}

function show({ artifacts = [], generatedFiles = [], summary = '', assistant = '', history = false, status = 'completed' }: {
  artifacts?: ArtifactSummary[]; generatedFiles?: GeneratedFile[]; summary?: string; assistant?: string;
  history?: boolean; status?: 'completed' | 'running';
}) {
  Element.prototype.scrollIntoView = vi.fn();
  const result: TaskResult = { summary, artifacts };
  const messages: ChatMessage[] = [{ id: 'user', role: 'user', content: '排查问题' }];
  if (assistant) messages.push({ id: 'assistant', role: 'assistant', content: assistant });
  if (history) messages.push({ id: 'result', role: 'result_card', content: '', result, generatedFiles });
  const open = vi.fn();
  render(<LocaleProvider><ChatView
    thread={{ id: 'thread', title: 'Files', status, mode: 'work', createdAt: 1, updatedAt: 1,
      starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: null, taskIds: [] }}
    messages={messages} streamingText="" status={status} currentQuestion={null}
    result={history ? null : result} generatedFiles={history ? [] : generatedFiles}
    prompt="" onPromptChange={vi.fn()} onSubmit={vi.fn()} onAnswer={vi.fn()} onCancel={vi.fn()}
    canvasOpen={false} onToggleCanvas={vi.fn()} onArtifactClick={open}
  /></LocaleProvider>);
  return open;
}

describe('chat bottom final deliverables', () => {
  it.each([false, true])('hides intermediate Windows scripts and drafts, live/history=%s', history => {
    const files = ['xk_display_watch.ps1', 'xk_display_watch.cs', 'launch_watch.cmd', 'draft.pdf', 'report.pdf']
      .map(name => artifact(`D:\\xiaok\\tmp\\${name}`));
    const summary = '已完成：[排查报告](D:/xiaok/tmp/report.pdf)';
    const open = show({ artifacts: files, summary, assistant: summary, history });
    expect(screen.getAllByTestId(/^generated-file-(?!actions-)/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('generated-file-report.pdf'));
    expect(open.mock.calls[0][0].filePath).toBe('D:\\xiaok\\tmp\\report.pdf');
    expect(files).toHaveLength(5);
  });

  it.each([false, true])('does not leave an empty result box for intermediate-only output, history=%s', history => {
    show({ artifacts: [artifact('/tmp/probe.ps1')], generatedFiles: [{ name: 'probe.ps1', filePath: '/tmp/probe.ps1' }], history });
    expect(screen.queryByTestId('task-result-card')).toBeNull();
  });

  it('keeps a script explicitly delivered in the final answer', () => {
    show({ artifacts: [artifact('/tmp/diagnose.ps1'), artifact('/tmp/probe.cs')], summary: '交付脚本：`diagnose.ps1`' });
    expect(screen.getByTestId('generated-file-diagnose.ps1')).toBeInTheDocument();
    expect(screen.queryByTestId('generated-file-probe.cs')).toBeNull();
  });

  it('uses final references for generated-file fallbacks', () => {
    show({ generatedFiles: ['prepare.py', 'draft.pdf', 'final.pdf'].map(name => ({ name, filePath: `/tmp/${name}` })),
      assistant: '交付：[报告](file:///tmp/final.pdf)' });
    expect(screen.getAllByTestId(/^generated-file-(?!actions-)/)).toHaveLength(1);
    expect(screen.getByTestId('generated-file-final.pdf')).toBeInTheDocument();
  });

  it('does not show files while the current task is running', () => {
    show({ generatedFiles: [{ name: 'final.pdf', filePath: '/tmp/final.pdf' }], summary: '`final.pdf`', status: 'running' });
    expect(screen.queryByTestId('task-result-card')).toBeNull();
  });

  it('does not match substrings or ambiguous basenames', () => {
    show({ artifacts: [artifact('/tmp/a/report.pdf'), artifact('/tmp/b/report.pdf'), artifact('/tmp/old-report.pdf')], summary: '`report.pdf`' });
    expect(screen.queryAllByTestId(/^generated-file-/)).toHaveLength(0);
  });

  it('matches encoded file URLs and keeps the exact directory', () => {
    show({ artifacts: [artifact('/tmp/a/最终 报告.pdf'), artifact('/tmp/b/最终 报告.pdf')],
      summary: '[报告](file:///tmp/a/%E6%9C%80%E7%BB%88%20%E6%8A%A5%E5%91%8A.pdf)' });
    expect(screen.getAllByTestId(/^generated-file-/)).toHaveLength(1);
  });

  it('does not treat fenced code examples as delivery references', () => {
    show({ artifacts: [artifact('/tmp/example.py')], summary: '示例：\n```python\n`example.py`\n```' });
    expect(screen.queryByTestId('generated-file-example.py')).toBeNull();
  });

  it('preserves explicitly registered and legacy document artifacts', () => {
    show({ artifacts: [artifact('/tmp/registered.ps1', 'kswarm'), { ...artifact('/tmp/report.pdf'), creator: undefined },
      { ...artifact('/tmp/probe.cmd'), creator: undefined }] });
    expect(screen.getByTestId('generated-file-registered.ps1')).toBeInTheDocument();
    expect(screen.getByTestId('generated-file-report.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('generated-file-probe.cmd')).toBeNull();
  });

  it('retains all final files across registered artifacts and generated fallbacks without duplicates', () => {
    show({ artifacts: [artifact('/tmp/report.pdf')], summary: '`/tmp/report.pdf` 与 `/tmp/notes.md`',
      generatedFiles: ['report.pdf', 'notes.md', 'prepare.py'].map(name => ({ name, filePath: `/tmp/${name}` })) });
    expect(screen.getAllByTestId('generated-file-report.pdf')).toHaveLength(1);
    expect(screen.getByTestId('generated-file-notes.md')).toBeInTheDocument();
    expect(screen.queryByTestId('generated-file-prepare.py')).toBeNull();
  });

  it.each([
    ['D:\\Results\\Report.PDF', '文件：\nD:/Results/Report.PDF'],
    ['\\\\server\\share\\report.pdf', '[报告](file://SERVER/share/REPORT.pdf)'],
    ['D:\\Results\\Report.PDF', '已交付 `REPORT.PDF`'],
    ['/tmp/report.pdf', '文件已保存到 /tmp/report.pdf。'],
  ])('supports final paths in native and URL forms: %s', (filePath, summary) => {
    show({ artifacts: [artifact(filePath)], summary });
    expect(screen.getAllByTestId(/^generated-file-(?!actions-)/)).toHaveLength(1);
  });

  it('does not match POSIX paths with a different case', () => {
    show({ artifacts: [artifact('/tmp/Report.pdf')], summary: '`/tmp/report.pdf`' });
    expect(screen.queryByTestId('generated-file-Report.pdf')).toBeNull();
  });
});
