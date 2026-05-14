import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactToolbar } from '../../renderer/src/components/ArtifactToolbar';
import type { ArtifactEditingState } from '../../renderer/src/hooks/artifact-editing-state';

// @vitest-environment jsdom

describe('ArtifactToolbar', () => {
  const mockToggle = vi.fn();
  const mockRevert = vi.fn();
  const mockFinish = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderToolbar(state: ArtifactEditingState) {
    return render(
      <ArtifactToolbar
        state={state}
        onToggleAnnotate={mockToggle}
        onRevert={mockRevert}
        onFinish={mockFinish}
      />,
    );
  }

  it('preview state: only shows annotate button', () => {
    const { container } = renderToolbar('preview');
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('标注');
  });

  it('annotating state: annotate button has active class', () => {
    const { container } = renderToolbar('annotating');
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('active');
  });

  it('reviewing state: shows annotate + revert + finish buttons', () => {
    const { container } = renderToolbar('reviewing');
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toContain('标注');
    expect(buttons[1].textContent).toContain('撤回');
    expect(buttons[2].textContent).toContain('完成');
  });

  it('clicking annotate calls onToggleAnnotate', () => {
    const { container } = renderToolbar('preview');
    fireEvent.click(container.querySelector('button')!);
    expect(mockToggle).toHaveBeenCalledOnce();
  });

  it('clicking revert calls onRevert', () => {
    const { container } = renderToolbar('reviewing');
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[1]); // revert button
    expect(mockRevert).toHaveBeenCalledOnce();
  });

  it('clicking finish calls onFinish', () => {
    const { container } = renderToolbar('reviewing');
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]); // finish button
    expect(mockFinish).toHaveBeenCalledOnce();
  });

  it('submitted state shows waiting status', () => {
    renderToolbar('submitted');
    expect(screen.getByText('等待 Agent 响应...')).toBeDefined();
  });

  it('timeout_idle state shows timeout status', () => {
    renderToolbar('timeout_idle');
    expect(screen.getByText('Agent 未响应，可继续操作')).toBeDefined();
  });
});
