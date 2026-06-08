import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2UI_MIME_TYPE, compileRenderUiToA2ui } from '../../../src/a2ui/index.js';
import { ChatView } from '../../renderer/src/components/ChatView';

const { mockReadFileContent } = vi.hoisted(() => ({
  mockReadFileContent: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    readFileContent: mockReadFileContent,
  },
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input-placeholder" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatView A2UI result card', () => {
  it('renders an A2UI artifact inline from the recorded artifact file', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const compiled = compileRenderUiToA2ui({
      title: 'Ops overview',
      sections: [
        { kind: 'heading', text: 'Ops overview', level: 1 },
        { kind: 'metric', label: 'Open tasks', value: 12, change: '-3' },
      ],
      data: {},
    }, { taskId: 'task_1', toolUseId: 'tool_1' });
    mockReadFileContent.mockResolvedValue({
      content: JSON.stringify(compiled.messages),
    });

    render(
      <ChatView
        thread={{
          id: 'thread-a2ui',
          title: 'A2UI 结果',
          status: 'completed',
          mode: 'work',
          createdAt: 1,
          updatedAt: 1,
          starred: false,
          gtdBucket: 'inbox',
          pinnedAt: null,
          currentTaskId: null,
          taskIds: [],
        }}
        messages={[]}
        streamingText=""
        status="completed"
        currentQuestion={null}
        result={{
          summary: '',
          artifacts: [{
            artifactId: 'artifact_1',
            kind: 'a2ui',
            title: 'ops-overview.a2ui.json',
            createdAt: 'turn_1',
            previewAvailable: true,
            filePath: '/tmp/ops-overview.a2ui.json',
            mimeType: A2UI_MIME_TYPE,
          }],
        }}
        generatedFiles={[]}
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
        canvasOpen={false}
        onToggleCanvas={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Ops overview' })).toBeDefined();
    expect(screen.getByText('Open tasks')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('-3')).toBeDefined();
    await waitFor(() => {
      expect(mockReadFileContent).toHaveBeenCalledWith('/tmp/ops-overview.a2ui.json');
    });
  });
});
