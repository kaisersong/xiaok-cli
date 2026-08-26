import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { DagNodeDetailDrawer } from '../../renderer/src/components/projects/DagNodeDetailDrawer';
import { DagNodeDetailErrorBoundary } from '../../renderer/src/components/projects/ProjectDagGraph';
import type { DagGraph, DagNode } from '../../renderer/src/components/projects/dagGraphModel';

afterEach(cleanup);

describe('DAG task node detail', () => {
  it('renders a string acceptance criterion without crashing the project page', () => {
    const onClose = vi.fn();
    const node: DagNode = {
      id: 'task-final-report',
      title: '生成最终报告',
      status: 'done',
      kind: 'task',
      task: {
        id: 'task-final-report',
        title: '生成最终报告',
        status: 'done',
        acceptanceCriteria: '最终交付物为 HTML，并包含日期与来源链接。',
      },
    };
    const graph: DagGraph = {
      nodes: [node],
      edges: [],
      source: 'task_board',
      partial: false,
    };

    render(
      <LocaleProvider>
        <DagNodeDetailDrawer node={node} graph={graph} onClose={onClose} />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: '生成最终报告' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('data-app-region', 'no-drag');
    expect(screen.getByText('最终交付物为 HTML，并包含日期与来源链接。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('degrades only the node detail when an unexpected render error occurs', () => {
    const BrokenDetail = () => { throw new Error('unexpected node shape'); };

    render(
      <div>
        <div>工作流仍然可见</div>
        <DagNodeDetailErrorBoundary
          resetKey="broken-node"
          errorMessage="节点详情暂时无法显示。你可以关闭详情后继续查看工作流。"
          closeLabel="关闭节点详情"
          onClose={() => {}}
        >
          <BrokenDetail />
        </DagNodeDetailErrorBoundary>
      </div>,
    );

    expect(screen.getByText('工作流仍然可见')).toBeInTheDocument();
    const fallback = screen.getByRole('alert');
    expect(fallback).toHaveTextContent('节点详情暂时无法显示');
    expect(fallback).toHaveAttribute('data-app-region', 'no-drag');
    expect(screen.getByRole('button', { name: '关闭节点详情' })).toBeInTheDocument();
  });
});
