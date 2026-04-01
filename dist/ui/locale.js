const TOOL_LABELS = {
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
};
export function getToolActivityLabel(toolName, locale = 'zh-CN') {
    return TOOL_LABELS[locale][toolName] ?? toolName;
}
export function getUiCopy(locale = 'zh-CN') {
    return UI_COPY[locale];
}
