import { assertJsonBudget } from './json-budget.js';
import { A2UI_LIMITS, SAFE_A2UI_CATALOG_ID, type A2UIComponent, type ValidationResult } from './protocol.js';
import { FORBIDDEN_KEYS, byteLength, containsDangerousPrototypeKey, fail, isRecord, validateChart } from './validation-helpers.js';
export { assertRenderUiInput, normalizeRenderUiInput, validateRenderUiInput } from './input-validator.js';

const ALLOWED_COMPONENTS = new Set([
  'Text',
  'Row',
  'Column',
  'Card',
  'Divider',
  'List',
  'Table',
  'MetricCard',
  'Chart',
]);

const ALLOWED_PROPS: Record<string, Set<string>> = {
  Chart: new Set(['id', 'component', 'title', 'chartType', 'points']),
  Text: new Set(['id', 'component', 'text', 'variant']),
  Row: new Set(['id', 'component', 'children', 'distribution', 'alignment']),
  Column: new Set(['id', 'component', 'children', 'distribution', 'alignment']),
  Card: new Set(['id', 'component', 'children']),
  Divider: new Set(['id', 'component']),
  List: new Set(['id', 'component', 'items']),
  Table: new Set(['id', 'component', 'columns', 'rows']),
  MetricCard: new Set(['id', 'component', 'label', 'value', 'change']),
};

const TEXT_VARIANTS = new Set(['h1', 'h2', 'h3', 'body']);
const DISTRIBUTIONS = new Set(['start', 'center', 'end', 'between']);
const ALIGNMENTS = new Set(['start', 'center', 'end', 'stretch']);
export function validateLegacyA2uiMessages(messages: unknown): ValidationResult {
  try { assertJsonBudget(messages); } catch { return fail('UI 数据超限或包含危险 key'); }
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
    if (raw.version !== 1) return fail('未知协议版本');
    if (Object.keys(raw).some(key => !['version','createSurface','updateComponents','updateDataModel','destroySurface'].includes(key))) return fail('未知 message 字段');
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
      if (!surfaceId || Object.keys(update).some(key => !['surfaceId','components'].includes(key))) return fail('updateComponents 字段或顺序无效');
      if (!surfaceMatches(surfaceId, update.surfaceId)) return fail('surfaceId 不一致');
      if (!Array.isArray(update.components)) return fail('components 必须是数组');
      if (update.components.length > A2UI_LIMITS.maxComponents) return fail('组件数量超限');
      components = update.components as A2UIComponent[];
      const componentResult = validateComponents(components);
      if (!componentResult.ok) return componentResult;
      continue;
    }

    const updateData = raw.updateDataModel;
    if (!isRecord(updateData) || !surfaceId) return fail('updateDataModel 无效');
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

export function validateComponents(components: A2UIComponent[]): ValidationResult {
  const seen = new Set<string>();
  for (const component of components) {
    if (!isRecord(component)) return fail('component 必须是对象');
    if (typeof component.id !== 'string' || !component.id || ['__proto__','prototype','constructor'].includes(component.id)) return fail('component id 无效');
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
  if (component.component === 'Chart') return validateChart(component);
  if (component.component === 'Text') {
    if (typeof component.text !== 'string') return fail('Text.text 必须是字符串');
    if (component.text.length > A2UI_LIMITS.maxStringLen) return fail('文本过长');
    if (component.variant != null && !TEXT_VARIANTS.has(component.variant)) return fail('Text.variant 无效');
  }
  if (component.component === 'MetricCard') {
    if (typeof component.label !== 'string' || component.label.length > A2UI_LIMITS.maxStringLen) return fail('MetricCard.label 必须是字符串');
    if (!isStringNumberOrPath(component.value)) return fail('MetricCard.value 无效');
    if (typeof component.value === 'string' && component.value.length > A2UI_LIMITS.maxMetricValueLen) return fail('metric value 过长');
    if (typeof component.value === 'number' && !Number.isFinite(component.value)) return fail('metric value 无效');
    if (component.change != null && (typeof component.change !== 'string' || component.change.length > A2UI_LIMITS.maxMetricValueLen)) return fail('MetricCard.change 必须是字符串');
  }
  if (component.component === 'Table') {
    if (!Array.isArray(component.columns) || !component.columns.every((value) => typeof value === 'string' && value.length <= A2UI_LIMITS.maxTableCellLen)) return fail('Table.columns 无效');
    if (component.columns.length > A2UI_LIMITS.maxTableCols) return fail('表格列数超限');
    if (!isRowsOrPath(component.rows)) return fail('Table.rows 无效');
  }
  if (component.component === 'List') {
    if (!Array.isArray(component.items) || component.items.length > 200 || !component.items.every((value) => typeof value === 'string' && value.length <= A2UI_LIMITS.maxStringLen)) return fail('List.items 无效');
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

  const parents = new Set<string>();
  for (const component of components) for (const child of component.children ?? []) {
    if (parents.has(child)) return fail('组件重复引用');
    parents.add(child);
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
  for (const component of components) {
    const value = component.component === 'MetricCard' ? component.value : component.component === 'Table' ? component.rows : null;
    if (isPathRef(value)) {
      let resolved: unknown = dataModel;
      for (const part of value.path.split('.')) resolved = isRecord(resolved) && Object.hasOwn(resolved, part) ? resolved[part] : undefined;
      const check = validateComponentValueTypes({ ...component, ...(component.component === 'Table' ? { rows: resolved as unknown[][] } : { value: resolved as string }) });
      if (!check.ok) return check;
    }
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
      if (cell !== null && !['string','number','boolean'].includes(typeof cell)) return fail('表格单元格必须为标量');
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

function surfaceMatches(expected: string, candidate: unknown): boolean {
  if (!expected) return typeof candidate === 'string' && candidate.length > 0;
  return candidate === expected;
}
