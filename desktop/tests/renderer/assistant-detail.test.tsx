import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  AssistantDetailPanel,
  type AssistantCandidateView,
} from '../../renderer/src/components/assistant/AssistantDetailPanel';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const candidates: AssistantCandidateView[] = [
  {
    id: 'memory-1',
    kind: 'memory',
    status: 'pending',
    title: '记住发布偏好',
    content: '正式发布前必须完成桌面端 E2E。',
    confidence: 0.94,
    evidenceRefs: [{ kind: 'thread', id: 'thread-1' }],
  },
  {
    id: 'knowledge-1',
    kind: 'knowledge',
    status: 'pending',
    title: '归档 MCP 评审结论',
    content: '将一致结论归档到知识库。',
    confidence: 0.88,
    evidenceRefs: [],
  },
];

describe('AssistantDetailPanel', () => {
  it('shows candidate provenance and only mutates after an explicit user decision', () => {
    const onAcceptCandidate = vi.fn();
    const onRejectCandidate = vi.fn();
    render(
      <LocaleProvider>
        <AssistantDetailPanel
          open
          profile={{ status: 'active', eveningTime: '21:30', morningTime: '08:30' }}
          candidates={candidates}
          knowledgeCollections={[{ id: 'collection-1', name: '产品知识' }]}
          onClose={() => {}}
          onAcceptCandidate={onAcceptCandidate}
          onRejectCandidate={onRejectCandidate}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText('正式发布前必须完成桌面端 E2E。')).toBeInTheDocument();
    expect(screen.getByText('thread · thread-1')).toBeInTheDocument();
    expect(screen.getAllByText('待确认')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '采纳：记住发布偏好' }));
    expect(onAcceptCandidate).toHaveBeenCalledWith('memory-1');
    fireEvent.click(screen.getByRole('button', { name: '忽略：记住发布偏好' }));
    expect(onRejectCandidate).toHaveBeenCalledWith('memory-1');
    const knowledgeAccept = screen.getByRole('button', { name: '采纳：归档 MCP 评审结论' });
    expect(knowledgeAccept).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: '选择知识库：归档 MCP 评审结论' }), {
      target: { value: 'collection-1' },
    });
    expect(knowledgeAccept).toBeEnabled();
    fireEvent.click(knowledgeAccept);
    expect(onAcceptCandidate).toHaveBeenCalledWith('knowledge-1', 'collection-1');
  });

  it('does not render when closed', () => {
    render(
      <LocaleProvider>
        <AssistantDetailPanel
          open={false}
          profile={{ status: 'active', eveningTime: '21:30', morningTime: '08:30' }}
          candidates={candidates}
          knowledgeCollections={[]}
          onClose={() => {}}
          onAcceptCandidate={() => {}}
          onRejectCandidate={() => {}}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('dialog', { name: '每日助理详情' })).not.toBeInTheDocument();
  });
});
