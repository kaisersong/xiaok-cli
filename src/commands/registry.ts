import type { SkillMeta } from '../ai/skills/loader.js';
import { CHAT_REMINDER_SLASH_COMMANDS } from './chat-reminder.js';

export interface ChatCommandMetadata {
  id: string;
  cmd: string;
  slashDesc: string;
  helpLine: string;
  showInSlash: boolean;
  showInHelp: boolean;
}

const BASE_CHAT_COMMANDS: ChatCommandMetadata[] = [
  {
    id: 'exit',
    cmd: '/exit',
    slashDesc: 'Exit the chat',
    helpLine: '  /exit    - 退出',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'clear',
    cmd: '/clear',
    slashDesc: 'Clear the screen',
    helpLine: '  /clear   - 清屏',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'compact',
    cmd: '/compact',
    slashDesc: 'Compact the current conversation context',
    helpLine: '  /compact - 压缩上下文',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'context',
    cmd: '/context',
    slashDesc: 'Show loaded repo context',
    helpLine: '  /context - 查看当前仓库上下文',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'models',
    cmd: '/models',
    slashDesc: 'Switch model',
    helpLine: '  /models  - 切换模型',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'mode',
    cmd: '/mode',
    slashDesc: 'Show or change permission mode',
    helpLine: '  /mode [default|auto|plan] - 查看或切换权限模式',
    showInSlash: true,
    showInHelp: true,
  },
  ...CHAT_REMINDER_SLASH_COMMANDS.map((command): ChatCommandMetadata => ({
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
    slashDesc: 'Show active CLI settings',
    helpLine: '  /settings - 查看当前生效配置',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'skills-reload',
    cmd: '/skills-reload',
    slashDesc: 'Reload the skill catalog',
    helpLine: '  /skills-reload - 刷新 skill 目录（安装后无需重启即可使用）',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'task',
    cmd: '/task',
    slashDesc: 'Show workflow task details by ID',
    helpLine: '  /task <id> - 查看任务详情',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'tasks',
    cmd: '/tasks',
    slashDesc: 'List workflow tasks',
    helpLine: '  /tasks   - 查看当前会话任务',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'yzjchannel',
    cmd: '/yzjchannel',
    slashDesc: 'Connect the embedded YZJ channel',
    helpLine: '  /yzjchannel - 连接云之家 channel（嵌入式，关闭 chat 即断开）',
    showInSlash: true,
    showInHelp: true,
  },
  {
    id: 'help',
    cmd: '/help',
    slashDesc: 'Show help',
    helpLine: '  /help    - 显示帮助',
    showInSlash: true,
    showInHelp: true,
  },
];

export function listChatCommandMetadata(): ChatCommandMetadata[] {
  return [...BASE_CHAT_COMMANDS];
}

export function getChatSlashCommands(): Array<{ cmd: string; desc: string }> {
  return listChatCommandMetadata()
    .filter((command) => command.showInSlash)
    .map((command) => ({ cmd: command.cmd, desc: command.slashDesc }));
}

export function getChatHelpLines(): string[] {
  return listChatCommandMetadata()
    .filter((command) => command.showInHelp)
    .map((command) => command.helpLine);
}

export function buildChatHelpText(skills: SkillMeta[]): string {
  const lines = ['', '可用命令：', ...getChatHelpLines()];
  if (skills.length > 0) {
    lines.push('', '可用 skills：');
    for (const skill of skills) {
      lines.push(`  /${skill.name} - ${skill.description}`);
    }
  }
  return lines.join('\n');
}
