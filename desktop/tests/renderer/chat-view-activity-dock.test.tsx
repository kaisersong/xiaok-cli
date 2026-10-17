import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatView } from '../../renderer/src/components/ChatView';

vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <div data-testid="composer" /> }));
it('keeps work updates beside the composer instead of inside the message transcript', () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(<LocaleProvider><ChatView
    thread={{ id: 'thread', title: '工作', status: 'idle', mode: 'chat', createdAt: 1, updatedAt: 1, taskIds: [], currentTaskId: null } as never}
    messages={[]} streamingText="" status="idle" currentQuestion={null} result={null} generatedFiles={[]}
    prompt="" onPromptChange={vi.fn()} onSubmit={vi.fn()} onAnswer={vi.fn()} onCancel={vi.fn()}
    canvasOpen={false} onToggleCanvas={vi.fn()} activityContent={<section data-testid="work-updates" />}
  /></LocaleProvider>);
  expect(screen.getByTestId('composer').parentElement).toContainElement(screen.getByTestId('work-updates'));
});
