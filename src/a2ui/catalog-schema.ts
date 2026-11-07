/** xiaok-safe/1.0: the custom analysis catalog used with the official A2UI envelope. */
const string = { type: 'string', maxLength: 10_000 };
const ref = {
  type: 'object',
  properties: { '@path': { type: 'string', maxLength: 1000 } },
  required: ['@path'],
  additionalProperties: false,
};
const children = { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string' } };
const rows = {
  type: 'array',
  maxItems: 200,
  items: { type: 'array', maxItems: 10, items: { type: ['string', 'number', 'boolean', 'null'] } },
};
const definitions: Record<string, Record<string, unknown>> = {
  Text: { text: string, variant: { enum: ['h1', 'h2', 'h3', 'body'] } },
  Row: {
    children,
    distribution: { enum: ['start', 'center', 'end', 'between'] },
    alignment: { enum: ['start', 'center', 'end', 'stretch'] },
  },
  Column: {
    children,
    distribution: { enum: ['start', 'center', 'end', 'between'] },
    alignment: { enum: ['start', 'center', 'end', 'stretch'] },
  },
  Card: { children },
  Divider: {},
  List: { items: { type: 'array', maxItems: 200, items: string } },
  Table: {
    columns: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 1000 } },
    rows: { anyOf: [rows, ref] },
  },
  MetricCard: {
    label: string,
    value: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'number' }, ref] },
    change: { type: 'string', maxLength: 50 },
  },
  Chart: {
    title: { type: 'string', maxLength: 1000 },
    chartType: { enum: ['bar', 'line'] },
    points: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 200 },
          value: { type: 'number', minimum: -1e15, maximum: 1e15 },
        },
        required: ['label', 'value'],
        additionalProperties: false,
      },
    },
  },
};
const required: Record<string, string[]> = {
  Text: ['text'],
  Row: ['children'],
  Column: ['children'],
  Card: ['children'],
  Divider: [],
  List: ['items'],
  Table: ['columns', 'rows'],
  MetricCard: ['label', 'value'],
  Chart: ['title', 'chartType', 'points'],
};
export const A2UI_CATALOG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  protocolVersion: '1.0',
  catalogId: 'xiaok-safe/1.0',
  title: 'xiaok analysis cards',
  components: Object.fromEntries(
    Object.entries(definitions).map(([component, props]) => [
      component,
      {
        type: 'object',
        properties: { component: { const: component }, ...props },
        required: ['component', ...required[component]!],
      },
    ]),
  ),
  functions: {},
  $defs: {
    anyFunction: false,
    anyComponent: {
      oneOf: Object.keys(definitions).map((name) => ({ $ref: `#/components/${name}` })),
      discriminator: { propertyName: 'component' },
    },
  },
};
