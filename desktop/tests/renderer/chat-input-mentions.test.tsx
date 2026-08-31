import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatInput } from '../../renderer/src/components/ChatInput';
import { api } from '../../renderer/src/api';

vi.mock('../../renderer/src/api', () => ({
  api: {
    listSkills: vi.fn().mockResolvedValue([
      { name: 'report', aliases: ['报告'], description: '生成报告', source: 'local', tier: 'user' },
    ]),
    onSkillsChanged: vi.fn(() => () => {}),
    selectMaterials: vi.fn(),
  },
}));

vi.mock('../../renderer/src/components/ChatModelPicker', () => ({
  ChatModelPicker: () => <button type="button">model</button>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderInput(onSubmit = vi.fn()) {
  return render(
    <LocaleProvider>
      <ChatInput
        onSubmit={onSubmit}
        mentionItems={[
          { id: 'agent-a', label: 'Agent A' },
          { id: 'agent-b', label: 'Agent B' },
        ]}
        mentionAllLabel="所有智能体"
      />
    </LocaleProvider>,
  );
}

describe('ChatInput mention routing UI', () => {
  it('shows @all and selectable agents, then inserts the stable agent id', async () => {
    renderInput();
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: '@', selectionStart: 1 } });

    expect(await screen.findByRole('button', { name: /@all.*所有智能体/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /@agent-a.*Agent A/ }));
    expect(textbox).toHaveValue('@agent-a ');
  });

  it('keeps the slash Skill menu and @ menu mutually exclusive', async () => {
    renderInput();
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: '/rep', selectionStart: 4 } });
    expect(await screen.findByRole('button', { name: /report.*生成报告/ })).toBeDefined();

    fireEvent.change(textbox, { target: { value: '@a', selectionStart: 2 } });
    expect(await screen.findByRole('button', { name: /@agent-a.*Agent A/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /report.*生成报告/ })).toBeNull();
  });

  it('preserves text and selected files when an async submit is rejected', async () => {
    vi.mocked(api.selectMaterials).mockResolvedValue({ filePaths: ['/tmp/room-input.md'] } as never);
    const onSubmit = vi.fn(async () => false);
    renderInput(onSubmit);

    fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
    expect(await screen.findByText('room-input.md')).toBeDefined();
    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: '请读取附件' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('请读取附件', [
      expect.objectContaining({ filePath: '/tmp/room-input.md', name: 'room-input.md' }),
    ]));
    expect(textbox).toHaveValue('请读取附件');
    expect(screen.getByText('room-input.md')).toBeDefined();
  });
});
