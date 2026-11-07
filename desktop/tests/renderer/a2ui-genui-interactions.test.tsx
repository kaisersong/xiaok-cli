import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileRenderUiToA2ui, A2UI_MIME_TYPE } from '../../../src/a2ui/index.js';
import { A2uiArtifactRenderer } from '../../renderer/src/components/a2ui/A2uiArtifactRenderer';
import { toSafeCsv } from '../../renderer/src/components/a2ui/analysis-table';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('generative analysis cards', () => {
  it('renders a compiler-produced chart and filters a table with native controls', () => {
    const output = compileRenderUiToA2ui(
      {
        title: 'Costs',
        sections: [
          { kind: 'heading', text: 'Monthly costs', level: 1 },
          {
            kind: 'chart',
            title: 'By department',
            chartType: 'bar',
            points: [
              { label: 'Sales', value: 40 },
              { label: 'Engineering', value: 60 },
            ],
          },
          {
            kind: 'table',
            columns: ['Department', 'Amount'],
            rows: [
              ['Sales', 40],
              ['Engineering', 60],
            ],
          },
        ],
      },
      { taskId: 'task', toolUseId: 'call' },
    );
    render(
      <LocaleProvider>
        <A2uiArtifactRenderer
          artifactContent={JSON.stringify(output.messages)}
          artifactRef={{ artifactId: 'card', type: 'artifact', mime_type: A2UI_MIME_TYPE }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Monthly costs' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'By department' })).toBeDefined();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Engineering' } });
    expect(screen.getByRole('cell', { name: 'Engineering' })).toBeDefined();
    expect(screen.queryByRole('cell', { name: 'Sales' })).toBeNull();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeDefined();
  });
  it('exports escaped CSV and neutralizes formula injection', () => {
    const csv = toSafeCsv(
      ['Name', 'Amount'],
      [
        ['=CMD()', 42],
        ['a,"b', -1],
        ['\t+cmd', '@x'],
      ],
    );
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain('"a,""b"');
    expect(csv).toContain("'\t+cmd");
    expect(csv).toContain("'@x");
  });
  it('still reads a historical version 1 payload', () => {
    render(
      <LocaleProvider>
        <A2uiArtifactRenderer
          artifactContent={JSON.stringify([
            {
              version: 1,
              createSurface: { surfaceId: 'a2ui-old-call', catalogId: 'xiaok-safe', root: 'root' },
            },
            {
              version: 1,
              updateComponents: {
                surfaceId: 'a2ui-old-call',
                components: [{ id: 'root', component: 'Text', text: 'Historic report' }],
              },
            },
          ])}
          artifactRef={{ artifactId: 'old', type: 'artifact' }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText('Historic report')).toBeDefined();
  });
});

describe('table export control', () => {
  it('downloads only the filtered rows through the real button', async () => {
    let exported: Blob | undefined;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exported = blob;
        return 'blob:analysis';
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const output = compileRenderUiToA2ui(
      {
        title: 'Data',
        sections: [{ kind: 'table', columns: ['Name'], rows: [['keep'], ['remove']] }],
      },
      { taskId: 't', toolUseId: 'c' },
    );
    render(
      <LocaleProvider>
        <A2uiArtifactRenderer
          artifactContent={JSON.stringify(output.messages)}
          artifactRef={{ artifactId: 'export', type: 'artifact' }}
        />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'keep' } });
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(click).toHaveBeenCalledOnce();
    expect(exported).toBeDefined();
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(exported!);
    });
    expect(content).toContain('keep');
    expect(content).not.toContain('remove');
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledOnce());
  });
});
