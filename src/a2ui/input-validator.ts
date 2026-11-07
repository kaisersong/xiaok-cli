import { assertJsonBudget } from './json-budget.js';
import { A2UI_LIMITS, RENDER_UI_SECTION_KINDS, type RenderUIInput, type RenderUISection, type RenderUISectionKind, type ValidationResult } from './protocol.js';
import { byteLength, containsForbiddenKey, fail, isRecord, validateChart } from './validation-helpers.js';

const RENDER_UI_SECTION_KIND_SET = new Set<RenderUISectionKind>(RENDER_UI_SECTION_KINDS);
const RENDER_UI_SECTION_KIND_LABEL = RENDER_UI_SECTION_KINDS.join('/');

export function validateRenderUiInput(input: unknown): ValidationResult {
  try { assertJsonBudget(input); } catch { return fail('UI 数据超限或包含危险 key'); }
  if (!isRecord(input)) return fail('input 必须是对象');
  if (Object.keys(input).some(key => !['title','sections','data','output_path','task_id'].includes(key))) return fail('未知 input 字段');
  if (input.data !== undefined && !isRecord(input.data)) return fail('data 必须是对象');
  if (input.output_path !== undefined && typeof input.output_path !== 'string') return fail('output_path 无效');
  if (input.task_id !== undefined && (typeof input.task_id !== 'string' || input.task_id.length > 200)) return fail('task_id 无效');
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
  const fields: Record<RenderUISectionKind,string[]> = {heading:['text','level'],text:['text','content'],metric:['label','value','change'],table:['columns','rows'],list:['items'],divider:[],chart:['title','chartType','points']};
  if (Object.keys(section).some(key => !['kind','type',...fields[kindResult.kind]].includes(key))) return fail('未知 section 字段');
  switch (kindResult.kind) {
    case 'chart':
      return validateChart(section);
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
      if ((typeof section.value !== 'string' && typeof section.value !== 'number') || !value || value.length > A2UI_LIMITS.maxMetricValueLen) return fail('metric value 无效');
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
          if (cell !== null && !['string','number','boolean'].includes(typeof cell)) return fail('表格单元格必须为标量');
          if (String(cell ?? '').length > A2UI_LIMITS.maxTableCellLen) return fail('单元格内容过长');
        }
      }
      return { ok: true };
    }
    case 'list': {
      if (!Array.isArray(section.items) || section.items.length > 200) return fail('list items 必须是数组');
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
    case 'chart':
      return { kind, title: record.title as string, chartType: record.chartType as 'bar' | 'line', points: record.points as Array<{label: string; value: number}> };
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
