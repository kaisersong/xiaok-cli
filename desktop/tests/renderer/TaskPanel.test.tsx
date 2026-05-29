import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TaskPanel } from '../../renderer/src/components/TaskPanel';

describe('TaskPanel', () => {
  const defaultProps = {
    planSteps: [
      { id: 'step-1', label: '分析需求', status: 'completed' },
      { id: 'step-2', label: '生成方案', status: 'running' },
      { id: 'step-3', label: '输出文档', status: 'planned' },
    ],
    status: 'running' as const,
    result: null,
    generatedFiles: [],
    onFileClick: vi.fn(),
    onArtifactClick: vi.fn(),
  };

  it('renders nothing when planSteps is empty', () => {
    const { container } = render(
      <TaskPanel {...defaultProps} planSteps={[]} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders plan steps with correct labels', () => {
    render(<TaskPanel {...defaultProps} />);
    expect(screen.getByText('分析需求')).toBeTruthy();
    expect(screen.getByText('生成方案')).toBeTruthy();
    expect(screen.getByText('输出文档')).toBeTruthy();
  });

  it('renders correct status icons for each step status', () => {
    const steps = [
      { id: 's1', label: 'Completed', status: 'completed' },
      { id: 's2', label: 'Running', status: 'running' },
      { id: 's3', label: 'Planned', status: 'planned' },
      { id: 's4', label: 'Blocked', status: 'blocked' },
      { id: 's5', label: 'Failed', status: 'failed' },
    ];
    const { container } = render(
      <TaskPanel {...defaultProps} planSteps={steps} />
    );
    const icons = container.querySelectorAll('.step-icon');
    expect(icons[0].textContent).toBe('●'); // completed
    expect(icons[1].textContent).toBe('◉'); // running
    expect(icons[2].textContent).toBe('○'); // planned
    expect(icons[3].textContent).toBe('⊘'); // blocked
    expect(icons[4].textContent).toBe('✕'); // failed
  });

  it('applies correct CSS class per step status', () => {
    const { container } = render(<TaskPanel {...defaultProps} />);
    const stepElements = container.querySelectorAll('.task-panel__step');
    expect(stepElements[0].classList.contains('task-panel__step--completed')).toBe(true);
    expect(stepElements[1].classList.contains('task-panel__step--running')).toBe(true);
    expect(stepElements[2].classList.contains('task-panel__step--planned')).toBe(true);
  });

  it('does not show results section when task is still running', () => {
    const { container } = render(
      <TaskPanel
        {...defaultProps}
        result={{ summary: '完成', artifacts: [{ artifactId: 'a1', kind: 'pptx', title: '方案.pptx', createdAt: 'now', previewAvailable: true, filePath: '/tmp/a.pptx' }] }}
      />
    );
    expect(container.querySelector('.task-panel__results')).toBeNull();
  });

  it('shows results section when task is completed with artifacts', () => {
    const result = {
      summary: '完成',
      artifacts: [
        { artifactId: 'a1', kind: 'pptx' as const, title: '方案.pptx', createdAt: 'now', previewAvailable: true, filePath: '/tmp/a.pptx' },
      ],
    };
    render(
      <TaskPanel {...defaultProps} status="completed" result={result} />
    );
    expect(screen.getByText('方案.pptx')).toBeTruthy();
    expect(screen.getByText('生成结果')).toBeTruthy();
  });

  it('calls onArtifactClick when artifact item is clicked', () => {
    const onArtifactClick = vi.fn();
    const result = {
      summary: '完成',
      artifacts: [
        { artifactId: 'a1', kind: 'pptx' as const, title: '方案.pptx', createdAt: 'now', previewAvailable: true, filePath: '/tmp/a.pptx' },
      ],
    };
    const { container } = render(
      <TaskPanel {...defaultProps} status="completed" result={result} onArtifactClick={onArtifactClick} />
    );
    const resultItem = within(container).getByRole('button', { name: '方案.pptx' });
    fireEvent.click(resultItem);
    expect(onArtifactClick).toHaveBeenCalledWith(result.artifacts[0]);
  });

  it('shows generated files that are not already artifacts', () => {
    const result = {
      summary: '完成',
      artifacts: [
        { artifactId: 'a1', kind: 'pptx' as const, title: '方案.pptx', createdAt: 'now', previewAvailable: true, filePath: '/tmp/a.pptx' },
      ],
    };
    const generatedFiles = [
      { filePath: '/tmp/a.pptx', name: '方案.pptx' }, // duplicate, should be filtered
      { filePath: '/tmp/b.md', name: '笔记.md' }, // unique, should show
    ];
    render(
      <TaskPanel {...defaultProps} status="completed" result={result} generatedFiles={generatedFiles} />
    );
    // 笔记.md should be visible as a generated file
    expect(screen.getByText('笔记.md')).toBeTruthy();
  });

  it('calls onFileClick when generated file item is clicked', () => {
    const onFileClick = vi.fn();
    const generatedFiles = [{ filePath: '/tmp/b.md', name: '笔记.md' }];
    const { container } = render(
      <TaskPanel {...defaultProps} status="completed" result={{ summary: '完成', artifacts: [] }} generatedFiles={generatedFiles} onFileClick={onFileClick} />
    );
    const resultItem = within(container).getByRole('button', { name: '笔记.md' });
    fireEvent.click(resultItem);
    expect(onFileClick).toHaveBeenCalledWith(generatedFiles[0]);
  });

  it('shows results section when status is idle (after completion)', () => {
    const result = {
      summary: '完成',
      artifacts: [
        { artifactId: 'a1', kind: 'html' as const, title: '报告.html', createdAt: 'now', previewAvailable: true },
      ],
    };
    render(
      <TaskPanel {...defaultProps} status="idle" result={result} />
    );
    expect(screen.getByText('报告.html')).toBeTruthy();
  });

  it('renders heading "进度"', () => {
    const { container } = render(<TaskPanel {...defaultProps} />);
    const heading = container.querySelector('.task-panel__heading');
    expect(heading).toBeTruthy();
    expect(heading!.textContent).toBe('进度');
  });
});
