import type { StatusBar } from '../ui/statusbar.js';
import { DEFAULT_STATUSLINE_FIELDS, STATUSLINE_FIELDS, normalizeStatuslineFields, saveStatuslineFields, statuslinePreferencePath } from '../ui/statusline-preferences.js';

export function runStatuslineCommand(argument: string, bar: StatusBar): string {
  const text = argument.trim();
  if (!text) {
    return [
      `当前字段：${bar.getFields().join(', ') || '已关闭'}`,
      `预览：${bar.getStatusLine() || '（无状态文本）'}`,
      '', ...Object.entries(STATUSLINE_FIELDS).map(([field, label]) => `  ${field} — ${label}`), '',
      '用法：/statusline model,branch,tokens,project（顺序即显示顺序，也可用空格分隔）',
      '      /statusline off | reset | on',
      `保存至：${statuslinePreferencePath()}；保存后的偏好优先于旧 settings.json 字段设置。`, '',
    ].join('\n');
  }
  try {
    const fields = text === 'off' ? [] : ['reset', 'on'].includes(text)
      ? [...DEFAULT_STATUSLINE_FIELDS] : normalizeStatuslineFields(text.split(/[,\s]+/).filter(Boolean));
    saveStatuslineFields(fields);
    bar.setFields(fields);
    return `状态栏已保存：${fields.join(', ') || '已关闭'}\n预览：${bar.getStatusLine() || '（无状态文本）'}\n`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith('未知字段') ? `${message}；输入 /statusline 查看可用字段。\n`
      : `状态栏保存失败，当前设置未变：${message}\n`;
  }
}
