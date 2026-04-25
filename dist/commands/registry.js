import { CHAT_REMINDER_SLASH_COMMANDS } from './chat-reminder.js';
const BASE_CHAT_COMMANDS = [
    {
        id: 'exit',
        cmd: '/exit',
        slashDesc: '退出当前对话',
        helpLine: '  /exit    - 退出',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'clear',
        cmd: '/clear',
        slashDesc: '清屏并重新显示欢迎页',
        helpLine: '  /clear   - 清屏',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'compact',
        cmd: '/compact',
        slashDesc: '压缩较早对话，减少上下文占用',
        helpLine: '  /compact - 压缩上下文',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'context',
        cmd: '/context',
        slashDesc: '查看当前自动加载的仓库上下文',
        helpLine: '  /context - 查看当前仓库上下文',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'models',
        cmd: '/models',
        slashDesc: '打开模型选择器',
        helpLine: '  /models  - 切换模型',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'mode',
        cmd: '/mode',
        slashDesc: '查看当前权限模式',
        helpLine: '  /mode [default|auto|plan] - 查看或切换权限模式',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'mode-default',
        cmd: '/mode default',
        slashDesc: '切到 default：危险操作前询问确认',
        helpLine: '',
        showInSlash: true,
        showInHelp: false,
    },
    {
        id: 'mode-auto',
        cmd: '/mode auto',
        slashDesc: '切到 auto：自动放行工具调用',
        helpLine: '',
        showInSlash: true,
        showInHelp: false,
    },
    {
        id: 'mode-plan',
        cmd: '/mode plan',
        slashDesc: '切到 plan：禁止写入和 bash，只做计划',
        helpLine: '',
        showInSlash: true,
        showInHelp: false,
    },
    ...CHAT_REMINDER_SLASH_COMMANDS.map((command) => ({
        id: command.cmd.slice(1),
        cmd: command.cmd,
        slashDesc: command.desc,
        helpLine: command.helpLine,
        showInSlash: true,
        showInHelp: true,
    })),
    {
        id: 'settings',
        cmd: '/settings',
        slashDesc: '查看当前生效配置',
        helpLine: '  /settings - 查看当前生效配置',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'skills-reload',
        cmd: '/skills-reload',
        slashDesc: '刷新 skill 目录，不用重启 chat',
        helpLine: '  /skills-reload - 刷新 skill 目录（安装后无需重启即可使用）',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'yzjchannel',
        cmd: '/yzjchannel',
        slashDesc: '连接嵌入式云之家 channel',
        helpLine: '  /yzjchannel - 连接云之家 channel（嵌入式，关闭 chat 即断开）',
        showInSlash: true,
        showInHelp: true,
    },
    {
        id: 'help',
        cmd: '/help',
        slashDesc: '查看可用命令和 skills',
        helpLine: '  /help    - 显示帮助',
        showInSlash: true,
        showInHelp: true,
    },
];
export function listChatCommandMetadata() {
    return [...BASE_CHAT_COMMANDS];
}
export function getChatSlashCommands() {
    return listChatCommandMetadata()
        .filter((command) => command.showInSlash)
        .map((command) => ({ cmd: command.cmd, desc: command.slashDesc }));
}
export function getChatHelpLines() {
    return listChatCommandMetadata()
        .filter((command) => command.showInHelp)
        .map((command) => command.helpLine);
}
export function buildChatHelpText(skills) {
    const lines = ['', '可用命令：', ...getChatHelpLines()];
    if (skills.length > 0) {
        lines.push('', '可用 skills：');
        for (const skill of skills) {
            lines.push(`  /${skill.name} - ${skill.description}`);
        }
    }
    return lines.join('\n');
}
