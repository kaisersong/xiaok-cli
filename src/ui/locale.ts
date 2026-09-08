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
    subAgents: {
      title: 'SubAgent', idle: '无活动', cleaning: '关闭·清理中',
      collaboration: 'SubAgent 协作', arranging: '安排 SubAgent', started: '开始', assignment: '分工', result: '交付摘要', elapsed: '耗时',
      tools: (count: number) => `${count} 次工具调用`, failures: (count: number) => `${count} 次失败`,
      round: (turn: number) => `第 ${turn} 轮`,
      constellations: ['双鱼座', '天秤座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天蝎座', '射手座', '摩羯座', '水瓶座'],
      phases: { starting: '初始化', model: '模型请求', thinking: '思考中', tool: '工具执行' },
      statuses: { pending: '排队', running: '运行中', completed: '完成', failed: '失败', interrupted: '已中断', closed: '已关闭' },
    },
    toolLabel: '工具',
    targetLabels: {
      command: '命令',
      file: '文件',
      path: '路径',
      pattern: '模式',
    },
    ranCollapseNotice: '… 更多命令已折叠（完成后按 Ctrl+O 查看）',
    hint: '数字直选  ↑↓ 切换  Enter 确认  Esc 取消',
  },
  en: {
    approvalTitle: 'xiaok wants to run',
    subAgents: {
      title: 'SubAgent', idle: 'idle ', cleaning: 'closed·cleaning',
      collaboration: 'SubAgent collaboration', arranging: 'Arrange SubAgent', started: 'started', assignment: 'Assignment', result: 'Result summary', elapsed: 'elapsed',
      tools: (count: number) => `${count} tool calls`, failures: (count: number) => `${count} failed`,
      round: (turn: number) => `turn ${turn}`,
      constellations: ['Pisces', 'Libra', 'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius'],
      phases: { starting: 'starting', model: 'model request', thinking: 'thinking', tool: 'tool' },
      statuses: { pending: 'queued', running: 'running', completed: 'completed', failed: 'failed', interrupted: 'interrupted', closed: 'closed' },
    },
    toolLabel: 'Tool',
    targetLabels: {
      command: 'Command',
      file: 'File',
      path: 'Path',
      pattern: 'Pattern',
    },
    ranCollapseNotice: '… More commands collapsed (press Ctrl+O after completion to view)',
    hint: '1-5 select  Up/Down navigate  Enter confirm  Esc cancel',
  },
} as const;

export function getToolActivityLabel(toolName: string, locale: UiLocale = 'zh-CN'): string {
  return TOOL_LABELS[locale][toolName] ?? toolName;
}

export function getUiCopy(locale: UiLocale = 'zh-CN') {
  return UI_COPY[locale];
}
