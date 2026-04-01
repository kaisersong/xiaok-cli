export type UiLocale = 'zh-CN' | 'en';

const TOOL_LABELS: Record<UiLocale, Record<string, string>> = {
  'zh-CN': {
    bash: '执行命令',
    web_fetch: '获取网页',
  },
  en: {
    bash: 'Run command',
    web_fetch: 'Fetch page',
  },
};

const UI_COPY = {
  'zh-CN': {
    approvalTitle: 'xiaok 想要执行以下操作',
    toolLabel: '工具',
    targetLabels: {
      command: '命令',
      file: '文件',
      path: '路径',
      pattern: '模式',
    },
    hint: '↑↓ 选择  Enter 确认  Esc 取消',
  },
  en: {
    approvalTitle: 'xiaok wants to run',
    toolLabel: 'Tool',
    targetLabels: {
      command: 'Command',
      file: 'File',
      path: 'Path',
      pattern: 'Pattern',
    },
    hint: 'Up/Down select  Enter confirm  Esc cancel',
  },
} as const;

export function getToolActivityLabel(toolName: string, locale: UiLocale = 'zh-CN'): string {
  return TOOL_LABELS[locale][toolName] ?? toolName;
}

export function getUiCopy(locale: UiLocale = 'zh-CN') {
  return UI_COPY[locale];
}
