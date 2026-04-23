export type UiLocale = 'zh-CN' | 'en';

const TOOL_LABELS: Record<UiLocale, Record<string, string>> = {
  'zh-CN': {
    bash: '执行命令',
    edit: '修改文件',
    glob: '匹配文件',
    grep: '搜索文本',
    install_skill: '安装 skill',
    read: '查看文件',
    skill: '加载 skill',
    tool_search: '查找工具',
    uninstall_skill: '卸载 skill',
    web_fetch: '获取网页',
    web_search: '搜索网页',
    write: '写入文件',
  },
  en: {
    bash: 'Run command',
    edit: 'Edit file',
    glob: 'Match files',
    grep: 'Search text',
    install_skill: 'Install skill',
    read: 'Read file',
    skill: 'Load skill',
    tool_search: 'Find tools',
    uninstall_skill: 'Uninstall skill',
    web_fetch: 'Fetch page',
    web_search: 'Search web',
    write: 'Write file',
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
