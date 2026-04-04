const TOOL_LABELS = {
    'zh-CN': {
        bash: '执行命令',
        edit: '修改文件',
        glob: '匹配文件',
        grep: '搜索文本',
        install_skill: '安装 skill',
        read: '查看文件',
        skill: '加载 skill',
        task_create: '创建任务',
        task_get: '查看任务',
        task_list: '查看任务列表',
        task_update: '更新任务',
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
        task_create: 'Create task',
        task_get: 'View task',
        task_list: 'List tasks',
        task_update: 'Update task',
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
};
export function getToolActivityLabel(toolName, locale = 'zh-CN') {
    return TOOL_LABELS[locale][toolName] ?? toolName;
}
export function getUiCopy(locale = 'zh-CN') {
    return UI_COPY[locale];
}
