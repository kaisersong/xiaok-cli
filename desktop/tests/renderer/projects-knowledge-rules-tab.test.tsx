import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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

describe('Knowledge & Rules tab', () => {
  it('separates builtin, user, workspace, and conflict sections', async () => {
    Object.defineProperty(window, 'xiaokDesktop', {
      configurable: true,
      value: {
        listPrinciples: vi.fn().mockResolvedValue([
          {
            id: 'prin-1',
            content: '研究结论必须标注来源',
            scenarios: ['planning', 'execution'],
            source: 'manual',
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        builtinPacks: [
          { id: 'research', version: 1, source: 'builtin', rules: [{ id: 'research.source_date_gap_disclosure' }] },
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
      }),
    } as Response));

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('内置知识')).toBeTruthy();
    });
    expect(screen.getByText('我的知识')).toBeTruthy();
    expect(screen.getByText('工作区知识')).toBeTruthy();
    expect(screen.getByText('冲突')).toBeTruthy();
    expect(screen.getByText('research')).toBeTruthy();
    expect(screen.getByText('研究结论必须标注来源')).toBeTruthy();
    expect(screen.getByText('高层报告必须有风险与建议')).toBeTruthy();
    expect(screen.getByText('优先使用 workspace 来源清单')).toBeTruthy();
    expect(screen.getAllByText(/executive_report\.decision_useful_synthesis/).length).toBeGreaterThan(0);
  });
});
