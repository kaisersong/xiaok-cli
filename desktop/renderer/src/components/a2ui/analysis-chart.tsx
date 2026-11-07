import React from 'react';
export function AnalysisChart({
  title,
  chartType,
  points,
}: {
  title: string;
  chartType: 'bar' | 'line';
  points: Array<{ label: string; value: number }>;
}) {
  const min = Math.min(0, ...points.map((p) => p.value)),
    max = Math.max(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const y = (value: number) => 160 - ((value - min) / span) * 140;
  const step = 560 / points.length;
  return (
    <section
      style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, minWidth: 0 }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>{title}</h3>
      <svg
        role="img"
        aria-label={title}
        viewBox="0 0 600 210"
        style={{ width: '100%', maxHeight: 260 }}
      >
        <title>{title}</title>
        <line x1="20" y1={y(0)} x2="580" y2={y(0)} stroke="currentColor" opacity=".2" />
        {chartType === 'line' ? (
          <polyline
            points={points.map((p, i) => `${20 + (i + 0.5) * step},${y(p.value)}`).join(' ')}
            fill="none"
            stroke="var(--c-accent, #5568d9)"
            strokeWidth="2"
          />
        ) : null}
        {points.map((p, i) => (
          <g key={i}>
            <title>{`${p.label}: ${p.value}`}</title>
            {chartType === 'bar' ? (
              <rect
                x={20 + i * step + step * 0.15}
                y={Math.min(y(p.value), y(0))}
                width={step * 0.7}
                height={Math.max(1, Math.abs(y(p.value) - y(0)))}
                rx="2"
                fill="var(--c-accent, #5568d9)"
              />
            ) : (
              <circle
                cx={20 + (i + 0.5) * step}
                cy={y(p.value)}
                r="3"
                fill="var(--c-accent, #5568d9)"
              />
            )}
            {points.length <= 12 ? (
              <text
                x={20 + (i + 0.5) * step}
                y="185"
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
              >
                {p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <details>
        <summary>{title}</summary>
        <table>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.label}</th>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
