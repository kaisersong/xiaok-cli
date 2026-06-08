import React from 'react';
import type { A2UIComponent, A2UIMessage } from '../../../../../src/a2ui/index.js';

type SurfaceModel = {
  rootId: string;
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
};

export function buildA2uiSurfaceModel(messages: A2UIMessage[]): SurfaceModel {
  let rootId = '';
  const components = new Map<string, A2UIComponent>();
  let dataModel: Record<string, unknown> = {};

  for (const message of messages) {
    if ('createSurface' in message) {
      rootId = message.createSurface.root;
      continue;
    }
    if ('updateComponents' in message) {
      components.clear();
      for (const component of message.updateComponents.components) {
        components.set(component.id, component);
      }
      continue;
    }
    if ('updateDataModel' in message) {
      dataModel = message.updateDataModel.value;
    }
  }

  return { rootId, components, dataModel };
}

export function A2uiSurfaceRenderer({ messages }: { messages: A2UIMessage[] }) {
  const model = buildA2uiSurfaceModel(messages);
  const root = model.components.get(model.rootId);
  if (!root) {
    throw new Error('A2UI root component missing');
  }

  return (
    <div className="xiaok-a2ui" style={styles.surface}>
      <A2uiComponentView component={root} model={model} />
    </div>
  );
}

function A2uiComponentView({ component, model }: { component: A2UIComponent; model: SurfaceModel }) {
  switch (component.component) {
    case 'Column':
      return (
        <div style={styles.column}>
          {(component.children ?? []).map((childId) => {
            const child = model.components.get(childId);
            return child ? <A2uiComponentView key={childId} component={child} model={model} /> : null;
          })}
        </div>
      );
    case 'Row':
      return (
        <div style={styles.row}>
          {(component.children ?? []).map((childId) => {
            const child = model.components.get(childId);
            return child ? <A2uiComponentView key={childId} component={child} model={model} /> : null;
          })}
        </div>
      );
    case 'Card':
      return (
        <section style={styles.card}>
          {(component.children ?? []).map((childId) => {
            const child = model.components.get(childId);
            return child ? <A2uiComponentView key={childId} component={child} model={model} /> : null;
          })}
        </section>
      );
    case 'Text':
      return renderText(component);
    case 'MetricCard':
      return (
        <section style={styles.metricCard}>
          <div style={styles.metricLabel}>{component.label}</div>
          <div style={styles.metricValue}>{String(resolveA2uiValue(component.value, model.dataModel) ?? '')}</div>
          {component.change ? <div style={styles.metricChange}>{component.change}</div> : null}
        </section>
      );
    case 'Table':
      return <A2uiTable component={component} model={model} />;
    case 'List':
      return (
        <ul style={styles.list}>
          {(component.items ?? []).map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
        </ul>
      );
    case 'Divider':
      return <hr style={styles.divider} />;
    default:
      return null;
  }
}

function renderText(component: A2UIComponent) {
  const text = component.text ?? '';
  if (component.variant === 'h1') return <h1 style={styles.h1}>{text}</h1>;
  if (component.variant === 'h2') return <h2 style={styles.h2}>{text}</h2>;
  if (component.variant === 'h3') return <h3 style={styles.h3}>{text}</h3>;
  return <p style={styles.text}>{text}</p>;
}

function A2uiTable({ component, model }: { component: A2UIComponent; model: SurfaceModel }) {
  const rows = resolveA2uiValue(component.rows, model.dataModel);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {(component.columns ?? []).map((column) => <th key={column} style={styles.th}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {Array.isArray(row) ? row.map((cell, cellIndex) => (
                <td key={`${rowIndex}:${cellIndex}`} style={styles.td}>{String(cell ?? '')}</td>
              )) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveA2uiValue(value: unknown, dataModel: Record<string, unknown>): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { path?: unknown }).path === 'string') {
    return readDotPath(dataModel, (value as { path: string }).path);
  }
  return value;
}

function readDotPath(model: Record<string, unknown>, path: string): unknown {
  let current: unknown = model;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const styles: Record<string, React.CSSProperties> = {
  surface: {
    maxWidth: 720,
    color: 'var(--c-text-primary)',
    background: 'transparent',
    fontSize: 14,
    lineHeight: 1.55,
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    gap: 12,
    alignItems: 'stretch',
  },
  card: {
    border: '1px solid var(--c-border)',
    borderRadius: 8,
    background: 'var(--c-bg-card)',
    padding: 12,
  },
  h1: {
    margin: '0 0 2px',
    fontSize: 22,
    lineHeight: 1.25,
    fontWeight: 650,
    color: 'var(--c-text-heading)',
  },
  h2: {
    margin: '0 0 2px',
    fontSize: 18,
    lineHeight: 1.3,
    fontWeight: 620,
    color: 'var(--c-text-heading)',
  },
  h3: {
    margin: '0 0 2px',
    fontSize: 15,
    lineHeight: 1.35,
    fontWeight: 600,
    color: 'var(--c-text-heading)',
  },
  text: {
    margin: 0,
    color: 'var(--c-text-primary)',
  },
  metricCard: {
    border: '1px solid var(--c-border)',
    borderRadius: 8,
    background: 'var(--c-bg-card)',
    padding: '12px 14px',
    minWidth: 140,
  },
  metricLabel: {
    fontSize: 12,
    color: 'var(--c-text-tertiary)',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 1.2,
    fontWeight: 650,
    color: 'var(--c-text-heading)',
  },
  metricChange: {
    fontSize: 12,
    color: 'var(--c-status-success-text, var(--c-accent))',
    marginTop: 5,
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--c-border)',
    borderRadius: 8,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid var(--c-border)',
    background: 'var(--c-bg-sub)',
    color: 'var(--c-text-secondary)',
    fontWeight: 600,
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--c-border-subtle, var(--c-border))',
    color: 'var(--c-text-primary)',
  },
  list: {
    margin: 0,
    paddingLeft: 20,
  },
  divider: {
    width: '100%',
    border: 0,
    borderTop: '1px solid var(--c-border)',
    margin: '4px 0',
  },
};
