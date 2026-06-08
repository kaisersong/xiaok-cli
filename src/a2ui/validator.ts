import {
  A2UI_LIMITS,
  RENDER_UI_SECTION_KINDS,
  SAFE_A2UI_CATALOG_ID,
  type A2UIComponent,
  type A2UIMessage,
  type RenderUIInput,
  type RenderUISection,
  type RenderUISectionKind,
  type ValidationResult,
} from './protocol.js';

const ALLOWED_COMPONENTS = new Set([
  'Text',
  'Row',
  'Column',
  'Card',
  'Divider',
  'List',
  'Table',
  'MetricCard',
]);

const ALLOWED_PROPS: Record<string, Set<string>> = {
  Text: new Set(['id', 'component', 'text', 'variant']),
  Row: new Set(['id', 'component', 'children', 'distribution', 'alignment']),
  Column: new Set(['id', 'component', 'children', 'distribution', 'alignment']),
  Card: new Set(['id', 'component', 'children']),
  Divider: new Set(['id', 'component']),
  List: new Set(['id', 'component', 'items']),
  Table: new Set(['id', 'component', 'columns', 'rows']),
  MetricCard: new Set(['id', 'component', 'label', 'value', 'change']),
};

const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'action',
  'actions',
  'onClick',
  'onclick',
  'event',
  'events',
  'style',
  'className',
  'color',
  'href',
  'src',
  'url',
]);

const TEXT_VARIANTS = new Set(['h1', 'h2', 'h3', 'body']);
const DISTRIBUTIONS = new Set(['start', 'center', 'end', 'between']);
const ALIGNMENTS = new Set(['start', 'center', 'end', 'stretch']);
const RENDER_UI_SECTION_KIND_SET = new Set<RenderUISectionKind>(RENDER_UI_SECTION_KINDS);
const RENDER_UI_SECTION_KIND_LABEL = RENDER_UI_SECTION_KINDS.join('/');

export function validateRenderUiInput(input: unknown): ValidationResult {
  if (!isRecord(input)) return fail('input 必须是对象');
  if (typeof input.title !== 'string' || input.title.trim().length === 0) return fail('title 必填');
  if (input.title.length > A2UI_LIMITS.maxStringLen) return fail('title 过长');
  if (!Array.isArray(input.sections)) return fail('sections 必须是数组');
  if (input.sections.length > A2UI_LIMITS.maxSections) return fail('sections 超限');

  for (let index = 0; index < input.sections.length; index++) {
    const result = validateSection(input.sections[index], index);
    if (!result.ok) return result;
  }

  const data = isRecord(input.data) ? input.data : {};
  const dataBytes = byteLength(JSON.stringify(data));
  if (dataBytes > A2UI_LIMITS.maxDataModelBytes) return fail('数据量超限');
  if (containsForbiddenKey(data)) return fail('包含危险 key');
  return { ok: true };
}

function validateSection(section: unknown, index: number): ValidationResult {
  if (!isRecord(section)) return fail(`sections[${index}] 必须是对象`);
  const kindResult = readSectionKind(section, index);
  if (!kindResult.ok) return kindResult;
  switch (kindResult.kind) {
    case 'heading': {
      if (typeof section.text !== 'string' || section.text.length > A2UI_LIMITS.maxStringLen) return fail('文本过长');
      if (section.level != null && section.level !== 1 && section.level !== 2 && section.level !== 3) return fail('heading level 无效');
      return { ok: true };
    }
    case 'text': {
      const content = typeof section.content === 'string' ? section.content : section.text;
      if (typeof content !== 'string' || content.length > A2UI_LIMITS.maxStringLen) return fail('内容过长');
      return { ok: true };
    }
    case 'metric': {
      if (typeof section.label !== 'string' || section.label.length > A2UI_LIMITS.maxStringLen) return fail('metric label 无效');
      const value = String(section.value ?? '');
      if (!value || value.length > A2UI_LIMITS.maxMetricValueLen) return fail('metric value 无效');
      if (section.change != null && (typeof section.change !== 'string' || section.change.length > A2UI_LIMITS.maxMetricValueLen)) return fail('metric change 无效');
      return { ok: true };
    }
    case 'table': {
      if (!Array.isArray(section.columns)) return fail('表格 columns 必须是数组');
      if (section.columns.length > A2UI_LIMITS.maxTableCols) return fail('表格列数超限');
      if (!section.columns.every((value) => typeof value === 'string' && value.length <= A2UI_LIMITS.maxTableCellLen)) return fail('表头内容过长');
      if (!Array.isArray(section.rows)) return fail('表格 rows 必须是数组');
      if (section.rows.length > A2UI_LIMITS.maxTableRows) return fail('表格行数超限');
      for (const row of section.rows) {
        if (!Array.isArray(row)) return fail('表格 row 必须是数组');
        if (row.length > A2UI_LIMITS.maxTableCols) return fail('表格列数超限');
        for (const cell of row) {
          if (String(cell ?? '').length > A2UI_LIMITS.maxTableCellLen) return fail('单元格内容过长');
        }
      }
      return { ok: true };
    }
    case 'list': {
      if (!Array.isArray(section.items)) return fail('list items 必须是数组');
      if (!section.items.every((item) => typeof item === 'string' && item.length <= A2UI_LIMITS.maxStringLen)) return fail('列表项过长');
      return { ok: true };
    }
    case 'divider':
      return { ok: true };
  }
}

export function assertRenderUiInput(input: unknown): RenderUIInput {
  const validation = validateRenderUiInput(input);
  if (!validation.ok) throw new Error(validation.reason);
  return normalizeRenderUiInput(input);
}

export function normalizeRenderUiInput(input: unknown): RenderUIInput {
  const validation = validateRenderUiInput(input);
  if (!validation.ok) throw new Error(validation.reason);
  const record = input as Record<string, unknown>;
  return {
    title: record.title as string,
    sections: (record.sections as unknown[]).map(normalizeRenderUiSection),
    ...(isRecord(record.data) ? { data: record.data } : {}),
    ...(typeof record.output_path === 'string' ? { output_path: record.output_path } : {}),
    ...(typeof record.task_id === 'string' ? { task_id: record.task_id } : {}),
  };
}

function normalizeRenderUiSection(section: unknown): RenderUISection {
  const record = section as Record<string, unknown>;
  const kindResult = readSectionKind(record, 0);
  if (!kindResult.ok) throw new Error(kindResult.reason);
  const kind = kindResult.kind;
  switch (kind) {
    case 'heading':
      return {
        kind,
        text: record.text as string,
        ...(record.level === 1 || record.level === 2 || record.level === 3 ? { level: record.level } : {}),
      };
    case 'text':
      return {
        kind,
        content: (typeof record.content === 'string' ? record.content : record.text) as string,
      };
    case 'metric':
      return {
        kind,
        label: record.label as string,
        value: record.value as string | number,
        ...(typeof record.change === 'string' ? { change: record.change } : {}),
      };
    case 'table':
      return {
        kind,
        columns: record.columns as string[],
        rows: record.rows as unknown[][],
      };
    case 'list':
      return {
        kind,
        items: record.items as string[],
      };
    case 'divider':
      return { kind };
  }
}

function readSectionKind(section: Record<string, unknown>, index: number): { ok: true; kind: RenderUISectionKind } | { ok: false; reason: string } {
  const kind = typeof section.kind === 'string' ? section.kind : undefined;
  const type = typeof section.type === 'string' ? section.type : undefined;
  if (kind && type && kind !== type) {
    return { ok: false, reason: `sections[${index}] kind/type 不一致: kind=${kind}, type=${type}` };
  }
  const value = kind ?? type;
  if (!value || !RENDER_UI_SECTION_KIND_SET.has(value as RenderUISectionKind)) {
    return { ok: false, reason: `sections[${index}] 未知 section kind: ${String(value ?? '(missing)')}; 支持: ${RENDER_UI_SECTION_KIND_LABEL}` };
  }
  return { ok: true, kind: value as RenderUISectionKind };
}

export function validateA2uiMessages(messages: unknown): ValidationResult {
  if (!Array.isArray(messages)) return fail('A2UI payload 必须是数组');
  if (messages.length === 0) return fail('A2UI payload 为空');
  if (messages.length > A2UI_LIMITS.maxMessages) return fail('消息数量超限');
  if (containsDangerousPrototypeKey(messages)) return fail('包含危险 key');

  let surfaceId = '';
  let rootId = '';
  let createCount = 0;
  let components: A2UIComponent[] = [];
  let dataModel: unknown = {};

  for (const raw of messages) {
    if (!isRecord(raw)) return fail('message 必须是对象');
    const operations = ['createSurface', 'updateComponents', 'updateDataModel', 'destroySurface']
      .filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
    if (operations.length !== 1) return fail('message 必须且只能包含一个操作');
    const operation = operations[0];
    if (operation === 'destroySurface') return fail('不允许的操作: destroySurface');
    if (operation !== 'createSurface' && operation !== 'updateComponents' && operation !== 'updateDataModel') return fail(`不允许的操作: ${operation}`);

    if (operation === 'createSurface') {
      createCount++;
      const create = raw.createSurface;
      if (!isRecord(create)) return fail('createSurface 无效');
      for (const key of Object.keys(create)) {
        if (!new Set(['surfaceId', 'catalogId', 'root']).has(key)) {
          if (FORBIDDEN_KEYS.has(key)) return fail(`禁止的 prop: createSurface.${key}`);
          return fail(`未知 prop: createSurface.${key}`);
        }
      }
      if (typeof create.surfaceId !== 'string' || !/^a2ui-[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+$/.test(create.surfaceId)) return fail('surfaceId 无效');
      if (create.catalogId !== SAFE_A2UI_CATALOG_ID) return fail('catalogId 必须为 xiaok-safe');
      if (typeof create.root !== 'string' || !create.root) return fail('root 无效');
      surfaceId = create.surfaceId;
      rootId = create.root;
      continue;
    }

    if (operation === 'updateComponents') {
      const update = raw.updateComponents;
      if (!isRecord(update)) return fail('updateComponents 无效');
      if (!surfaceMatches(surfaceId, update.surfaceId)) return fail('surfaceId 不一致');
      if (!Array.isArray(update.components)) return fail('components 必须是数组');
      if (update.components.length > A2UI_LIMITS.maxComponents) return fail('组件数量超限');
      components = update.components as A2UIComponent[];
      const componentResult = validateComponents(components);
      if (!componentResult.ok) return componentResult;
      continue;
    }

    const updateData = raw.updateDataModel;
    if (!isRecord(updateData)) return fail('updateDataModel 无效');
    for (const key of Object.keys(updateData)) {
      if (!new Set(['surfaceId', 'path', 'value']).has(key)) {
        if (FORBIDDEN_KEYS.has(key)) return fail(`禁止的 prop: updateDataModel.${key}`);
        return fail(`未知 prop: updateDataModel.${key}`);
      }
    }
    if (!surfaceMatches(surfaceId, updateData.surfaceId)) return fail('surfaceId 不一致');
    if (updateData.path !== '') return fail('data model path 必须为空字符串');
    const bytes = byteLength(JSON.stringify(updateData.value ?? {}));
    if (bytes > A2UI_LIMITS.maxDataModelBytes) return fail('数据量超限');
    dataModel = updateData.value ?? {};
  }

  if (createCount !== 1) return fail('必须包含一个 createSurface');
  if (!rootId) return fail('root surface 缺失');
  if (components.length === 0) return fail('components 为空');

  const treeResult = validateTree(rootId, components);
  if (!treeResult.ok) return treeResult;

  const pathResult = validateDynamicPaths(components, dataModel);
  if (!pathResult.ok) return pathResult;

  return { ok: true };
}

function validateComponents(components: A2UIComponent[]): ValidationResult {
  const seen = new Set<string>();
  for (const component of components) {
    if (!isRecord(component)) return fail('component 必须是对象');
    if (typeof component.id !== 'string' || !component.id) return fail('component id 无效');
    if (seen.has(component.id)) return fail('component id 重复');
    seen.add(component.id);
    if (typeof component.component !== 'string' || !ALLOWED_COMPONENTS.has(component.component)) return fail(`未知组件: ${String(component.component)}`);
    const allowed = ALLOWED_PROPS[component.component];
    for (const key of Object.keys(component)) {
      if (FORBIDDEN_KEYS.has(key)) return fail(`禁止的 prop: ${key}`);
      if (!allowed?.has(key)) return fail(`未知 prop: ${component.component}.${key}`);
      if (byteLength(JSON.stringify((component as Record<string, unknown>)[key])) > A2UI_LIMITS.maxSinglePropBytes) return fail('单个 prop 超限');
    }
    const typeResult = validateComponentValueTypes(component);
    if (!typeResult.ok) return typeResult;
  }
  return { ok: true };
}

function validateComponentValueTypes(component: A2UIComponent): ValidationResult {
  if (component.children != null) {
    if (!Array.isArray(component.children) || component.children.length > A2UI_LIMITS.maxChildrenPerNode || !component.children.every((value) => typeof value === 'string')) {
      return fail('children 必须是 string id 数组');
    }
  }
  if (component.component === 'Text') {
    if (typeof component.text !== 'string') return fail('Text.text 必须是字符串');
    if (component.text.length > A2UI_LIMITS.maxStringLen) return fail('文本过长');
    if (component.variant != null && !TEXT_VARIANTS.has(component.variant)) return fail('Text.variant 无效');
  }
  if (component.component === 'MetricCard') {
    if (typeof component.label !== 'string') return fail('MetricCard.label 必须是字符串');
    if (!isStringNumberOrPath(component.value)) return fail('MetricCard.value 无效');
    if (component.change != null && typeof component.change !== 'string') return fail('MetricCard.change 必须是字符串');
  }
  if (component.component === 'Table') {
    if (!Array.isArray(component.columns) || !component.columns.every((value) => typeof value === 'string')) return fail('Table.columns 无效');
    if (component.columns.length > A2UI_LIMITS.maxTableCols) return fail('表格列数超限');
    if (!isRowsOrPath(component.rows)) return fail('Table.rows 无效');
  }
  if (component.component === 'List') {
    if (!Array.isArray(component.items) || !component.items.every((value) => typeof value === 'string')) return fail('List.items 无效');
  }
  if (component.distribution != null && !DISTRIBUTIONS.has(component.distribution)) return fail('distribution 无效');
  if (component.alignment != null && !ALIGNMENTS.has(component.alignment)) return fail('alignment 无效');
  return { ok: true };
}

function validateTree(rootId: string, components: A2UIComponent[]): ValidationResult {
  const byId = new Map(components.map((component) => [component.id, component]));
  if (!byId.has(rootId)) return fail('root component 不存在');

  for (const component of components) {
    for (const childId of component.children ?? []) {
      if (!byId.has(childId)) return fail(`children 引用了不存在的组件: ${childId}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, depth: number): ValidationResult => {
    if (depth > A2UI_LIMITS.maxTreeDepth) return fail('组件树深度超限');
    if (visiting.has(id)) return fail('组件树存在循环');
    if (visited.has(id)) return { ok: true };
    visiting.add(id);
    const component = byId.get(id);
    for (const childId of component?.children ?? []) {
      const result = visit(childId, depth + 1);
      if (!result.ok) return result;
    }
    visiting.delete(id);
    visited.add(id);
    return { ok: true };
  };

  const result = visit(rootId, 1);
  if (!result.ok) return result;
  if (visited.size !== components.length) return fail('存在孤儿组件');
  return { ok: true };
}

function validateDynamicPaths(components: A2UIComponent[], dataModel: unknown): ValidationResult {
  const allowedPaths = new Set<string>();
  for (const component of components) {
    if (component.component === 'MetricCard') {
      if (isPathRef(component.value)) {
        const expected = `metrics.${component.id}.value`;
        if (component.value.path !== expected) return fail('数据路径不允许');
        allowedPaths.add(expected);
      }
    }
    if (component.component === 'Table') {
      if (isPathRef(component.rows)) {
        const expected = `tables.${component.id}.rows`;
        if (component.rows.path !== expected) return fail('数据路径不允许');
        allowedPaths.add(expected);
      }
    }
  }

  if (!isRecord(dataModel)) return fail('data model 必须是对象');
  const modelPaths = collectLeafPaths(dataModel);
  for (const path of modelPaths) {
    if (!allowedPaths.has(path)) return fail('data model 包含未引用路径');
  }
  for (const path of allowedPaths) {
    if (!hasPath(dataModel, path)) return fail(`data model 缺少路径: ${path}`);
  }
  return { ok: true };
}

function validateRows(rows: unknown[][]): ValidationResult {
  if (rows.length > A2UI_LIMITS.maxTableRows) return fail('表格行数超限');
  for (const row of rows) {
    if (row.length > A2UI_LIMITS.maxTableCols) return fail('表格列数超限');
    for (const cell of row) {
      if (String(cell ?? '').length > A2UI_LIMITS.maxTableCellLen) return fail('单元格内容过长');
    }
  }
  return { ok: true };
}

function isRowsOrPath(value: unknown): value is unknown[][] | { path: string } {
  if (isPathRef(value)) return true;
  if (!Array.isArray(value)) return false;
  return value.every((row) => Array.isArray(row)) && validateRows(value as unknown[][]).ok;
}

function isStringNumberOrPath(value: unknown): value is string | number | { path: string } {
  return typeof value === 'string' || typeof value === 'number' || isPathRef(value);
}

function isPathRef(value: unknown): value is { path: string } {
  return isRecord(value) && typeof value.path === 'string' && Object.keys(value).length === 1;
}

function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (!isRecord(value)) return prefix ? [prefix] : [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isRecord(child)) paths.push(...collectLeafPaths(child, next));
    else paths.push(next);
  }
  return paths;
}

function hasPath(value: unknown, path: string): boolean {
  let current = value;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item));
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (containsForbiddenKey(value[key])) return true;
  }
  return false;
}

function containsDangerousPrototypeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsDangerousPrototypeKey(item));
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (containsDangerousPrototypeKey(value[key])) return true;
  }
  return false;
}

function surfaceMatches(expected: string, candidate: unknown): boolean {
  if (!expected) return typeof candidate === 'string' && candidate.length > 0;
  return candidate === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}
