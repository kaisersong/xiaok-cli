import React, { useMemo } from 'react';
import { defineCatalog, type Spec } from '@json-render/core';
import { defineRegistry, Renderer, JSONUIProvider } from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { z } from 'zod4';
import { normalizeA2uiMessages, type A2UIComponent } from '../../../../shared/a2ui';
import { AnalysisTable } from './analysis-table';
import { AnalysisChart } from './analysis-chart';

const container = { props: z.object({}).strict(), slots: ['default'] };
const catalog = defineCatalog(schema, {
  components: {
    Column: container,
    Row: container,
    Card: container,
    Text: {
      props: z
        .object({ text: z.string(), variant: z.enum(['h1', 'h2', 'h3', 'body']).optional() })
        .strict(),
    },
    MetricCard: {
      props: z
        .object({
          label: z.string(),
          value: z.union([z.string(), z.number()]),
          change: z.string().optional(),
        })
        .strict(),
    },
    Table: {
      props: z
        .object({
          columns: z.array(z.string()),
          rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
        })
        .strict(),
    },
    List: { props: z.object({ items: z.array(z.string()) }).strict() },
    Divider: { props: z.object({}).strict() },
    Chart: {
      props: z
        .object({
          title: z.string(),
          chartType: z.enum(['bar', 'line']),
          points: z.array(z.object({ label: z.string(), value: z.number() })),
        })
        .strict(),
    },
  },
  actions: {},
});
const { registry } = defineRegistry(catalog, {
  components: {
    Column: ({ children }) => <div style={styles.column}>{children}</div>,
    Row: ({ children }) => <div style={styles.row}>{children}</div>,
    Card: ({ children }) => <section style={styles.card}>{children}</section>,
    Text: ({ props }) => {
      const Tag = props.variant && props.variant !== 'body' ? props.variant : 'p';
      return <Tag style={styles[props.variant ?? 'text'] ?? styles.text}>{props.text}</Tag>;
    },
    MetricCard: ({ props }) => (
      <section style={styles.metricCard}>
        <div style={styles.metricLabel}>{props.label}</div>
        <div style={styles.metricValue}>{props.value}</div>
        {props.change ? <div style={styles.metricChange}>{props.change}</div> : null}
      </section>
    ),
    Table: ({ props }) => <AnalysisTable columns={props.columns} rows={props.rows} />,
    List: ({ props }) => (
      <ul style={styles.list}>
        {props.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    ),
    Divider: () => <hr style={styles.divider} />,
    Chart: ({ props }) => <AnalysisChart {...props} />,
  },
});
export function buildA2uiSurfaceModel(input: unknown) {
  const messages = normalizeA2uiMessages(input);
  let rootId = '';
  const components = new Map<string, A2UIComponent>();
  let dataModel: Record<string, unknown> = {};
  for (const message of messages) {
    if ('createSurface' in message) rootId = message.createSurface.root;
    else if ('updateComponents' in message) {
      components.clear();
      for (const c of message.updateComponents.components) components.set(c.id, c);
    } else if ('updateDataModel' in message) dataModel = message.updateDataModel.value;
  }
  return { rootId, components, dataModel };
}
export function buildA2uiSpec(input: unknown): Spec | null {
  const model = buildA2uiSurfaceModel(input);
  if (!model.rootId) return null;
  const elements: Spec['elements'] = {};
  for (const [id, component] of model.components) {
    const { id: _id, component: type, children, ...rest } = component;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (['alignment', 'distribution'].includes(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value) && 'path' in value) {
        let current: unknown = model.dataModel;
        for (const part of String(value.path).split('.'))
          current =
            current && typeof current === 'object' && Object.hasOwn(current, part)
              ? (current as Record<string, unknown>)[part]
              : undefined;
        props[key] = current;
      } else props[key] = value;
    }
    // Decoder restricts props to scalars and arrays of scalars/plain chart points.
    // No model-produced json-render directives, actions or visibility enter this Spec.
    elements[id] = { type, props, children: children ?? [] };
  }
  const spec = { root: model.rootId, elements };
  const validation = catalog.validate(spec);
  if (!validation.success) throw Error('Invalid analysis catalog spec');
  return spec;
}
export function A2uiSurfaceRenderer({ messages }: { messages: unknown }) {
  const spec = useMemo(() => buildA2uiSpec(messages), [messages]);
  if (!spec) return null;
  return (
    <div className="xiaok-a2ui" style={styles.surface}>
      <JSONUIProvider registry={registry} handlers={{}}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
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
    flexWrap: 'wrap',
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
