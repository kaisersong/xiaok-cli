import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CreateProjectModal } from '../../renderer/src/components/projects/CreateProjectModal';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(props?: Partial<ComponentProps<typeof CreateProjectModal>>) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <CreateProjectModal
        open={true}
        agents={[
          { id: 'xiaok-po', name: 'PO-Agent', status: 'idle', runtimeType: 'xiaok', roles: ['project_owner'] },
          { id: 'xiaok-worker', name: 'Worker-Agent', status: 'idle', runtimeType: 'xiaok', roles: ['worker'] },
          { id: 'codex-worker', name: 'Codex', status: 'idle', runtimeType: 'codex', roles: ['worker'] },
        ]}
        onClose={() => {}}
        onCreate={onCreate}
        {...props}
      />
    </LocaleProvider>,
  );
  return { onCreate };
}

describe('CreateProjectModal defaults', () => {
  it('defaults to xiaok-po and includes xiaok-worker when the user does not manually pick members', async () => {
    const { onCreate } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('例：竞品分析报告'), { target: { value: '测试项目' } });
    fireEvent.change(screen.getByPlaceholderText('描述你希望完成什么...'), { target: { value: '验证默认种子智能体' } });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: '测试项目',
        goal: '验证默认种子智能体',
        poAgent: 'xiaok-po',
        members: ['xiaok-worker'],
      }));
    });
  });

  it('does not inject xiaok-worker when the user explicitly changes member selection', async () => {
    const { onCreate } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    fireEvent.change(screen.getByPlaceholderText('例：竞品分析报告'), { target: { value: '测试项目' } });
    fireEvent.change(screen.getByPlaceholderText('描述你希望完成什么...'), { target: { value: '验证手工成员优先' } });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        poAgent: 'xiaok-po',
        members: ['codex-worker'],
      }));
    });
  });
});
