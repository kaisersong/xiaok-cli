import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolStepsMessage } from '../../renderer/src/components/ToolStepsMessage';

afterEach(() => cleanup());

const INTERNAL_DASHBOARD_TOOL = ['render', 'ui'].join('_');

describe('ToolStepsMessage A2UI redaction', () => {
  it('shows a structured summary without raw dashboard input or internal tool names', () => {
    render(<ToolStepsMessage live={false} steps={[{
      toolUseId: 'tool_1',
      toolName: INTERNAL_DASHBOARD_TOOL,
      input: {
        title: 'Sensitive report',
        sections: [{ kind: 'text', content: 'SECRET_CUSTOMER_TOKEN' }],
        data: { token: 'SECRET_DATA_TOKEN' },
      },
      displayInputSummary: '[A2UI] Sensitive report - 1 section, 48 B',
      status: 'done',
      response: JSON.stringify({ ok: true, artifactPath: 'artifacts/sensitive.a2ui.json' }),
      startedAt: 1,
      finishedAt: 2,
    }]} />);

    expect(screen.getByText('[A2UI] Sensitive report - 1 section, 48 B')).toBeDefined();
    expect(screen.queryByText(INTERNAL_DASHBOARD_TOOL)).toBeNull();
    expect(screen.queryByText(/SECRET_CUSTOMER_TOKEN/)).toBeNull();
    expect(screen.queryByText(/SECRET_DATA_TOKEN/)).toBeNull();
  });
});
