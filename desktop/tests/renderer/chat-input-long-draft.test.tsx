import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatInput } from '../../renderer/src/components/ChatInput';

vi.mock('../../renderer/src/api', () => ({
  api: {
    listSkills: vi.fn().mockResolvedValue([]),
    selectMaterials: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
});

describe('ChatInput long draft layout', () => {
  it('caps long textarea drafts and keeps the overflow scrollable inside the input', () => {
    const longDraft = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行诊断上下文`).join('\n');

    render(
      <ChatInput
        value={longDraft}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const textarea = screen.getByPlaceholderText('回复...') as HTMLTextAreaElement;

    expect(textarea).toHaveStyle({ maxHeight: '220px' });
    expect(textarea.style.overflowY).toBe('auto');
  });
});
