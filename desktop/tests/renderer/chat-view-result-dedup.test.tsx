import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView, type ChatMessage, type GeneratedFile } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import type { ArtifactSummary, TaskResult } from '../../shared/task-types';

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input-placeholder" />,
}));

const thread = {
  id: 'thread-result-dedup',
  title: 'Result dedup',
  status: 'completed' as const,
  mode: 'work' as const,
  createdAt: 1,
  updatedAt: 1,
  starred: false,
  gtdBucket: 'inbox' as const,
  pinnedAt: null,
  currentTaskId: null,
  taskIds: [],
};

function taskResult(summary: string, artifacts: ArtifactSummary[] = []): TaskResult {
  return { summary, artifacts };
}

function resultCard(id: string, summary: string, artifacts: ArtifactSummary[] = [], generatedFiles: GeneratedFile[] = []): ChatMessage {
  return {
    id,
    role: 'result_card',
    content: '',
    result: taskResult(summary, artifacts),
    generatedFiles,
  };
}

function htmlArtifact(artifactId: string, title: string): ArtifactSummary {
  return {
    artifactId,
    kind: 'html',
    title,
    createdAt: 'turn-1',
    previewAvailable: true,
    filePath: `/tmp/${title}`,
    mimeType: 'text/html',
  };
}

function renderChat({
  messages,
  result = null,
  generatedFiles = [],
  status = 'completed',
}: {
  messages: ChatMessage[];
  result?: TaskResult | null;
  generatedFiles?: GeneratedFile[];
  status?: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed';
}) {
  return render(
    <LocaleProvider>
      <ChatView
        thread={thread}
        messages={messages}
        streamingText=""
        status={status}
        currentQuestion={null}
        result={result}
        generatedFiles={generatedFiles}
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
        canvasOpen={false}
        onToggleCanvas={vi.fn()}
        onArtifactClick={vi.fn()}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatView Result 摘要去重', () => {
  it('历史 assistant 与 result_card 摘要相同时只显示正文且不留下空卡片或重复操作', () => {
    const { container } = renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '问题' },
        { id: 'assistant-1', role: 'assistant', content: '相同回答正文' },
        resultCard('result-1', '相同回答正文'),
      ],
    });

    expect(screen.getAllByText('相同回答正文')).toHaveLength(1);
    expect(screen.queryByTestId('task-result-card')).toBeNull();
    expect(screen.getAllByTitle('复制')).toHaveLength(2);
    expect(screen.getAllByTitle('收藏到知识库')).toHaveLength(2);
    expect(screen.queryByTitle('添加到知识库')).toBeNull();
    const messageStack = container.querySelector('.space-y-6');
    expect(messageStack).not.toBeNull();
    const resultMessageOuterWrappers = Array.from(messageStack!.children).filter(
      child => child.firstElementChild?.classList.contains('group/resultmsg'),
    );
    expect(resultMessageOuterWrappers).toHaveLength(0);
  });

  it('相同摘要有 artifact 时隐藏摘要操作但保留产物操作', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '生成报告' },
        { id: 'assistant-1', role: 'assistant', content: '报告已经生成' },
        resultCard('result-1', '报告已经生成', [htmlArtifact('artifact-report', 'report.html')]),
      ],
    });

    expect(screen.getAllByText('报告已经生成')).toHaveLength(1);
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(1);
    expect(screen.getAllByTitle('复制')).toHaveLength(2);
    expect(screen.getAllByTitle('收藏到知识库')).toHaveLength(2);
    expect(screen.getAllByTitle('添加到知识库')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '直接编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开' })).toBeInTheDocument();
    expect(screen.getByTestId('generated-file-report.html')).toBeInTheDocument();
  });

  it('assistant 与 Result 摘要不同时保留两份内容和 Result 摘要操作', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '问题' },
        { id: 'assistant-1', role: 'assistant', content: '详细回答正文' },
        resultCard('result-1', '不同的结果摘要'),
      ],
    });

    expect(screen.getByText('详细回答正文')).toBeInTheDocument();
    expect(screen.getByText('不同的结果摘要')).toBeInTheDocument();
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(1);
    expect(screen.getAllByTitle('复制')).toHaveLength(3);
    expect(screen.getAllByTitle('收藏到知识库')).toHaveLength(3);
    expect(screen.getAllByTitle('添加到知识库')).toHaveLength(1);
  });

  it('live 底部 Result 与当前 assistant 相同时只显示一次', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '问题' },
        { id: 'assistant-1', role: 'assistant', content: 'live 完整回答' },
      ],
      result: taskResult('live 完整回答'),
    });

    expect(screen.getAllByText('live 完整回答')).toHaveLength(1);
    expect(screen.queryByTestId('task-result-card')).toBeNull();
  });

  it('仅首尾空白和换行风格不同时仍去重', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '问题' },
        { id: 'assistant-1', role: 'assistant', content: '# 同一个标题' },
      ],
      result: taskResult(' \r\n# 同一个标题\r\n'),
    });

    expect(screen.getAllByRole('heading', { name: '同一个标题' })).toHaveLength(1);
    expect(screen.queryByTestId('task-result-card')).toBeNull();
  });

  it('历史 Result 卡片不阻止新一轮 live artifact 显示', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮问题' },
        { id: 'assistant-1', role: 'assistant', content: '第一轮回答' },
        resultCard('result-1', '第一轮回答'),
        { id: 'user-2', role: 'user', content: '第二轮问题' },
        { id: 'assistant-2', role: 'assistant', content: '第二轮回答' },
      ],
      result: taskResult('第二轮回答', [htmlArtifact('artifact-current', 'current.html')]),
    });

    expect(screen.getAllByText('第二轮回答')).toHaveLength(1);
    expect(screen.getByTestId('generated-file-current.html')).toBeInTheDocument();
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(1);
  });

  it('历史 Result 卡片不阻止新一轮 generatedFiles-only 入口和操作', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮问题' },
        { id: 'assistant-1', role: 'assistant', content: '第一轮回答' },
        resultCard('result-1', '第一轮回答'),
        { id: 'user-2', role: 'user', content: '生成文本文件' },
      ],
      result: null,
      generatedFiles: [{ filePath: '/tmp/current.txt', name: 'current.txt' }],
      status: 'idle',
    });

    expect(screen.getByTestId('generated-file-current.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开' })).toBeInTheDocument();
    expect(screen.getByTitle('添加到知识库')).toBeInTheDocument();
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(1);
  });

  it('当前轮没有 assistant 时不会用上一轮同文正文误删当前唯一摘要', () => {
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮问题' },
        { id: 'assistant-1', role: 'assistant', content: '跨轮相同正文' },
        resultCard('result-1', '跨轮相同正文', [htmlArtifact('artifact-old', 'old.html')]),
        { id: 'user-2', role: 'user', content: '第二轮问题' },
      ],
      result: taskResult('跨轮相同正文'),
    });

    expect(screen.getAllByText('跨轮相同正文')).toHaveLength(2);
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(2);
    expect(screen.getByTestId('generated-file-old.html')).toBeInTheDocument();
  });

  it('当前轮已有 result_card 时不再追加 standalone Result', () => {
    const artifact = htmlArtifact('artifact-current', 'current.html');
    renderChat({
      messages: [
        { id: 'user-1', role: 'user', content: '生成当前报告' },
        { id: 'assistant-1', role: 'assistant', content: '当前报告已生成' },
        resultCard('result-1', '当前报告已生成', [artifact]),
      ],
      result: taskResult('当前报告已生成', [artifact]),
    });

    expect(screen.getAllByText('当前报告已生成')).toHaveLength(1);
    expect(screen.getAllByTestId('task-result-card')).toHaveLength(1);
    expect(screen.getAllByTestId('generated-file-current.html')).toHaveLength(1);
  });
});
