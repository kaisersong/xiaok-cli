import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => null }));

import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(cleanup);

describe('ChatView user message theme contrast', () => {
  it('uses paired theme tokens instead of a fixed light background', () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <LocaleProvider>
        <ChatView
          thread={{ id: 'thread-1', title: 'Theme test' } as never}
          messages={[{ id: 'user-1', role: 'user', content: '深色模式可读消息' }]}
          streamingText=""
          status="idle"
          currentQuestion={null}
          result={null}
          generatedFiles={[]}
          prompt=""
          onPromptChange={vi.fn()}
          onSubmit={vi.fn()}
          onAnswer={vi.fn()}
          onCancel={vi.fn()}
          canvasOpen={false}
          onToggleCanvas={() => {}}
        />
      </LocaleProvider>,
    );

    const bubble = screen.getByText('深色模式可读消息');
    expect(bubble.className).toContain('bg-[var(--c-bg-deep)]');
    expect(bubble.className).toContain('text-[var(--c-text-primary)]');
    expect(bubble.style.background).toBe('');
  });
});
