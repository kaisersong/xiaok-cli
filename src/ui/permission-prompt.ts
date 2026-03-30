import { stdin, stdout } from 'process';
import { dirname } from 'path';
import { boldCyan, dim, yellow, bold } from './render.js';
import type { PermissionChoice } from '../types.js';

interface PromptOption {
  label: string;
  choice: PermissionChoice;
}

/** 从工具输入中提取关键参数用于展示 */
function extractTarget(input: Record<string, unknown>): { key: string; value: string } | null {
  if (typeof input.command === 'string') return { key: '命令', value: input.command };
  if (typeof input.file_path === 'string') return { key: '文件', value: input.file_path };
  if (typeof input.path === 'string') return { key: '路径', value: input.path };
  if (typeof input.pattern === 'string') return { key: '模式', value: input.pattern };
  return null;
}

/** 从工具输入推导 glob 规则 */
export function deriveRule(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === 'string') {
    // bash(npm *) — 取第一个 token 作为前缀
    const firstToken = input.command.split(/\s+/)[0];
    if (firstToken) return `${toolName}(${firstToken} *)`;
    return toolName;
  }
  if (typeof input.file_path === 'string') {
    // write(src/utils/*) — 取父目录
    const dir = dirname(input.file_path);
    return `${toolName}(${dir}/*)`;
  }
  if (typeof input.path === 'string') {
    const dir = dirname(input.path);
    return `${toolName}(${dir}/*)`;
  }
  return toolName;
}

/** 截断过长文本 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * 交互式权限确认选择器。
 * 显示工具信息 + 箭头键可选的多行选项列表。
 */
export async function showPermissionPrompt(
  toolName: string,
  input: Record<string, unknown>,
): Promise<PermissionChoice> {
  const target = extractTarget(input);
  const rule = deriveRule(toolName, input);

  // 构建选项列表
  const options: PromptOption[] = [
    { label: '允许一次', choice: { action: 'allow_once' } },
    { label: `本次会话始终允许 ${bold(rule)}`, choice: { action: 'allow_session', rule } },
    { label: `始终允许 ${bold(rule)} (保存到项目)`, choice: { action: 'allow_project', rule } },
    { label: `始终允许 ${bold(rule)} (保存到全局)`, choice: { action: 'allow_global', rule } },
    { label: '拒绝', choice: { action: 'deny' } },
  ];

  // 非 TTY 环境下默认拒绝
  if (!stdin.isTTY) {
    return { action: 'deny' };
  }

  let selectedIdx = 0;

  return new Promise((resolve) => {
    let resolved = false;

    // 计算 header 行数（用于清理）
    const headerLines: string[] = [];
    headerLines.push('');
    headerLines.push(`  ${yellow('⚡')} xiaok 想要执行以下操作：`);
    headerLines.push('');
    headerLines.push(`  工具：  ${boldCyan(toolName)}`);
    if (target) {
      headerLines.push(`  ${target.key}：  ${dim(truncate(target.value, 80))}`);
    }
    headerLines.push('');

    const totalLines = headerLines.length + options.length + 2; // +2: hint line + trailing

    const renderAll = () => {
      // Header
      for (const line of headerLines) {
        stdout.write(line + '\n');
      }
      // Options
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selectedIdx;
        const prefix = isSelected ? boldCyan('❯') : ' ';
        const label = isSelected ? boldCyan(opt.label) : dim(opt.label);
        stdout.write(`  ${prefix} ${label}\n`);
      }
      // Hint
      stdout.write(`\n  ${dim('↑↓ 选择  Enter 确认  Esc 取消')}`);
      // Move cursor back to top of rendered block
      stdout.write(`\x1b[${totalLines - 1}A`);
    };

    const clearAll = () => {
      stdout.write('\x1b7'); // save cursor
      for (let i = 0; i < totalLines; i++) {
        stdout.write('\n\x1b[2K');
      }
      stdout.write('\x1b8'); // restore cursor
    };

    const done = (choice: PermissionChoice) => {
      if (resolved) return;
      resolved = true;
      clearAll();
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();

      // 显示选择结果的简短摘要（左对齐，无缩进）
      const summary = choice.action === 'deny' ? '已拒绝' :
        choice.action === 'allow_once' ? '已允许（一次）' :
        choice.action === 'allow_session' ? `已允许（会话：${(choice as any).rule}）` :
        choice.action === 'allow_project' ? `已允许（项目：${(choice as any).rule}）` :
        `已允许（全局：${(choice as any).rule}）`;
      stdout.write(`${dim(summary)}\n`);

      resolve(choice);
    };

    const onData = (data: Buffer) => {
      const key = data.toString('utf8');

      // Ctrl-C / Esc → 拒绝
      if (key === '\x03' || key === '\x1b') {
        done({ action: 'deny' });
        return;
      }

      // Enter → 选择当前项
      if (key === '\r' || key === '\n') {
        done(options[selectedIdx].choice);
        return;
      }

      // Up arrow
      if (key === '\x1b[A') {
        clearAll();
        selectedIdx = (selectedIdx - 1 + options.length) % options.length;
        renderAll();
        return;
      }

      // Down arrow
      if (key === '\x1b[B') {
        clearAll();
        selectedIdx = (selectedIdx + 1) % options.length;
        renderAll();
        return;
      }
    };

    renderAll();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
