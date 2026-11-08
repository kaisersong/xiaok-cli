import React, { useMemo, useState } from 'react';
import { useLocale } from '../../contexts/LocaleContext';
export function toSafeCsv(columns: string[], rows: unknown[][]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
export function AnalysisTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        row.some((cell) =>
          String(cell ?? '')
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        ),
      ),
    [query, rows],
  );
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([toSafeCsv(columns, visible)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'analysis.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          type="search"
          aria-label={t.a2uiTableFilter}
          placeholder={t.a2uiTableFilter}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            minWidth: 120,
            flex: '1 1 180px',
            background: 'var(--c-bg-card)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: '6px 8px',
            color: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={download}
          style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 10px' }}
        >
          {t.a2uiExportCsv}
        </button>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--c-border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr>
              {columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  style={{ padding: '8px 10px', background: 'var(--c-bg-sub)' }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{ padding: '8px 10px', borderTop: '1px solid var(--c-border)' }}
                  >
                    {String(cell ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p role="status" style={{ padding: 12 }}>
            {t.a2uiNoRows}
          </p>
        ) : null}
      </div>
    </section>
  );
}
