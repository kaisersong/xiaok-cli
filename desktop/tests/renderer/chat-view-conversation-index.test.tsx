import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChatView, type ChatMessage } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => null }));

const messages: ChatMessage[] = [
  { id: 'user-1', role: 'user', content: '第一条提示词：分析当前实现' },
  { id: 'assistant-1', role: 'assistant', content: '先检查现有代码。' },
  { id: 'user-2', role: 'user', content: '第二条提示词：增加快速跳转能力' },
  { id: 'assistant-2', role: 'assistant', content: '**开始实现。**\n会先补测试。' },
  { id: 'user-3', role: 'user', content: '第三条提示词：验证 hover 波动效果' },
];

function renderChat(chatMessages: ChatMessage[]) {
  return render(
    <LocaleProvider>
      <ChatView
        thread={{ id: 'thread-index', title: '索引测试' } as never}
        messages={chatMessages}
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
        onToggleCanvas={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe('ChatView conversation prompt index', () => {
  const scrolledElements: Element[] = [];

  beforeEach(() => {
    scrolledElements.length = 0;
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolledElements.push(this);
    });
  });

  afterEach(cleanup);

  it('stays hidden for a single prompt and appears for a multi-turn conversation', () => {
    const { rerender } = renderChat(messages.slice(0, 2));
    expect(screen.queryByRole('navigation', { name: '提示词索引' })).not.toBeInTheDocument();

    rerender(
      <LocaleProvider>
        <ChatView
          thread={{ id: 'thread-index', title: '索引测试' } as never}
          messages={messages}
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
          onToggleCanvas={vi.fn()}
        />
      </LocaleProvider>,
    );

    const index = screen.getByRole('navigation', { name: '提示词索引' });
    expect(within(index).getAllByRole('button')).toHaveLength(3);
  });

  it('shows a local wave and prompt preview on hover', () => {
    renderChat(messages);
    const index = screen.getByRole('navigation', { name: '提示词索引' });
    const buttons = within(index).getAllByRole('button');
    const widthsBeforeHover = buttons.map(button => Number.parseFloat(button.style.width));
    const lines = buttons.map(button => button.querySelector('.conversation-index-tick-line'));

    expect(new Set(widthsBeforeHover)).toEqual(new Set([10]));
    expect(lines[0]).toHaveClass('conversation-index-tick-line-emphasized');
    expect(lines[1]).not.toHaveClass('conversation-index-tick-line-emphasized');

    fireEvent.mouseEnter(buttons[1]);

    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByTestId('conversation-index-prompt-preview')).toHaveTextContent('第二条提示词：增加快速跳转能力');
    expect(within(tooltip).getByTestId('conversation-index-response-preview')).toHaveTextContent('开始实现。 会先补测试。');
    expect(within(tooltip).getByTestId('conversation-index-response-preview')).not.toHaveTextContent('**');
    expect(within(tooltip).getByTestId('conversation-index-prompt-preview')).toHaveClass('truncate');
    expect(within(tooltip).getByTestId('conversation-index-response-preview')).toHaveClass('line-clamp-2');
    expect(Number.parseFloat(buttons[1].style.width)).toBeGreaterThan(widthsBeforeHover[1]);
    expect(Number.parseFloat(buttons[2].style.width)).toBeGreaterThan(widthsBeforeHover[2]);
    expect(Number.parseFloat(buttons[0].style.width)).toBeGreaterThan(10);
  });

  it('moves the summary vertically with the hovered tick and omits a missing response', () => {
    renderChat(messages);
    const index = screen.getByRole('navigation', { name: '提示词索引' });
    const buttons = within(index).getAllByRole('button');
    vi.spyOn(index, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 220, left: 0, right: 42, width: 42, height: 120, x: 0, y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(buttons[0], 'getBoundingClientRect').mockReturnValue({
      top: 108, bottom: 120, left: 4, right: 14, width: 10, height: 12, x: 4, y: 108,
      toJSON: () => ({}),
    });
    vi.spyOn(buttons[2], 'getBoundingClientRect').mockReturnValue({
      top: 132, bottom: 144, left: 4, right: 14, width: 10, height: 12, x: 4, y: 132,
      toJSON: () => ({}),
    });

    fireEvent.mouseEnter(buttons[0]);
    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '14px' });

    fireEvent.mouseEnter(buttons[2]);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveStyle({ top: '38px' });
    expect(within(tooltip).queryByTestId('conversation-index-response-preview')).toBeNull();
  });

  it('smoothly jumps to the selected user prompt anchor', () => {
    renderChat(messages);
    scrolledElements.length = 0;

    const index = screen.getByRole('navigation', { name: '提示词索引' });
    fireEvent.click(within(index).getAllByRole('button')[1]);

    const selected = scrolledElements.at(-1) as HTMLElement | undefined;
    expect(selected?.dataset.messageAnchor).toBe('user-2');
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('updates the current prompt when the conversation is scrolled', async () => {
    renderChat(messages);
    const scrollContainer = screen.getByTestId('chat-scroll-container');
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 600 });
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const promptTops = [-80, 100, 280];
    for (const [index, anchor] of Array.from(document.querySelectorAll('[data-message-anchor]')).entries()) {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        top: promptTops[index],
        bottom: promptTops[index] + 40,
        left: 56,
        right: 720,
        width: 664,
        height: 40,
        x: 56,
        y: promptTops[index],
        toJSON: () => ({}),
      });
    }

    fireEvent.scroll(scrollContainer);

    const buttons = within(screen.getByRole('navigation', { name: '提示词索引' })).getAllByRole('button');
    await waitFor(() => expect(buttons[1]).toHaveAttribute('aria-current', 'location'));
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(buttons[2]).not.toHaveAttribute('aria-current');
  });
});
