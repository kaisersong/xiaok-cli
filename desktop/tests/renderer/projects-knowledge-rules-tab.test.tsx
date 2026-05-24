import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PrinciplesTab } from '../../renderer/src/components/projects/PrinciplesTab';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as any).xiaokDesktop;
});

function renderTab() {
  render(
    <LocaleProvider>
      <PrinciplesTab />
    </LocaleProvider>,
  );
}

function stubDesktop(principles: any[] = []) {
  Object.defineProperty(window, 'xiaokDesktop', {
    configurable: true,
    value: {
      listPrinciples: vi.fn().mockResolvedValue(principles),
      savePrinciple: vi.fn().mockResolvedValue({ success: true }),
      deletePrinciple: vi.fn().mockResolvedValue({ success: true }),
    },
  });
}

const qualityKnowledgeResponse = {
  knowledgeDocuments: [
    {
      id: 'research.default_knowledge',
      packId: 'research',
      title: '研究默认知识',
      source: 'builtin',
      readOnly: true,
      content: '研究结论必须标注来源、日期和证据缺口。',
      rules: ['research.source_date_gap_disclosure'],
    },
  ],
  builtinPacks: [
    {
      id: 'research',
      version: 1,
      source: 'builtin',
      rules: [
        {
          id: 'research.source_date_gap_disclosure',
          description: '近期研究必须说明证据缺口',
          severity: 'hard',
        },
      ],
    },
    { id: 'executive_report', version: 1, source: 'builtin', rules: [{ id: 'executive_report.final_artifact_polish' }] },
  ],
  userOverlays: [
    { id: 'executive_report.decision_useful_synthesis', description: '高层报告必须有风险与建议', severity: 'hard' },
  ],
  workspaceOverlays: [
    { id: 'research.workspace_source_priority', description: '优先使用 workspace 来源清单', severity: 'soft' },
  ],
  conflicts: [
    { ruleId: 'executive_report.decision_useful_synthesis', resolution: 'user_override', chosenSeverity: 'hard' },
  ],
};

describe('Knowledge & Rules tab', () => {
  it('separates knowledge documents from rules and can open a builtin knowledge document', async () => {
    stubDesktop([
      {
        id: 'prin-1',
        content: '客户知识文档：研究结论必须标注来源',
        scenarios: ['planning', 'execution'],
        source: 'manual',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => qualityKnowledgeResponse,
    } as Response));

    renderTab();

    expect(await screen.findByRole('button', { name: '知识' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '规则' })).toBeTruthy();
    expect(screen.getByText('默认知识')).toBeTruthy();
    expect(screen.getByText('我的知识')).toBeTruthy();
    expect(screen.getByText('研究默认知识')).toBeTruthy();
    expect(screen.getByText('客户知识文档：研究结论必须标注来源')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(screen.getAllByText('研究结论必须标注来源、日期和证据缺口。').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '规则' }));
    expect(screen.getByText('内置规则')).toBeTruthy();
    expect(screen.getByText('我的规则')).toBeTruthy();
    expect(screen.getByText('工作区规则')).toBeTruthy();
    expect(screen.getByText('高层报告必须有风险与建议')).toBeTruthy();
    expect(screen.getByText('优先使用 workspace 来源清单')).toBeTruthy();
    expect(screen.getAllByText(/executive_report\.decision_useful_synthesis/).length).toBeGreaterThan(0);
  });

  it('opens a solid modal with separate new-knowledge and new-rule tabs', async () => {
    stubDesktop();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => qualityKnowledgeResponse,
    } as Response));

    renderTab();

    await screen.findByText('默认知识');
    fireEvent.click(screen.getByRole('button', { name: '添加知识' }));

    const modal = await screen.findByTestId('knowledge-rule-modal');
    expect(modal.className).toContain('bg-[var(--c-bg-card)]');
    expect(modal.getAttribute('style')).toContain('background');
    expect(screen.getByRole('button', { name: '新建知识' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建规则' })).toBeTruthy();
    expect(screen.getByText('知识文档')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '新建规则' }));
    expect(screen.getByText('规则项')).toBeTruthy();
  });

  it('extracts rules from a knowledge document and applies the confirmed patch', async () => {
    stubDesktop();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/quality/rules/extract')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            rules: [
              {
                id: 'global.research-source-required',
                packId: 'global',
                severity: 'hard',
                appliesTo: ['review'],
                description: '研究必须引用来源',
                metadata: { sourceKnowledgeId: 'research.default_knowledge' },
              },
            ],
            patch: {
              patchId: 'qextract-research-default-knowledge',
              initiatedBy: 'user',
              confirmedBy: 'user',
              trustedInput: true,
              target: 'user_knowledge_overlay',
              affectedPacks: ['global'],
              operations: [],
            },
          }),
        } as Response;
      }
      if (url.endsWith('/quality/patches/apply')) {
        expect(init?.method).toBe('POST');
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => qualityKnowledgeResponse,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: '提取规则' }));
    expect(await screen.findByText('研究必须引用来源')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4400/quality/patches/apply',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByText('规则已保存')).toBeTruthy();
  });
});
