import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../renderer/src/api', () => ({
  api: {
    createThread: vi.fn(),
    createTask: vi.fn(),
    createTaskWithFiles: vi.fn(),
    updateThreadTaskId: vi.fn(),
  },
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

import { WelcomePage } from '../../renderer/src/components/WelcomePage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('WelcomePage quick prompts', () => {
  it('keeps the project prompt on a complete two-row quick prompt grid', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    );

    const projectPrompt = '创建项目, 让2个智能体搞定本月国外主要AI产品动态分析';
    const oldProjectPrompt = '创建项目，让2个智能体搞定本月国外主要AI产品动态分析';
    const promptGrid = screen.getByTestId('quick-prompts');
    const projectButton = screen.getByRole('button', { name: projectPrompt });

    expect(screen.queryByRole('button', { name: oldProjectPrompt })).not.toBeInTheDocument();
    expect(promptGrid).toHaveClass('grid', 'grid-cols-4');
    expect(promptGrid.querySelectorAll('button')).toHaveLength(6);
    expect(projectButton).toHaveClass('col-span-3', 'whitespace-nowrap', 'overflow-hidden', 'text-ellipsis');
    expect(projectButton).toHaveAttribute('title', projectPrompt);
  });
});
