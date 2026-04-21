import { stdin, stdout } from 'process';
import { dirname } from 'path';
import { boldCyan, dim, yellow } from './render.js';
import { getUiCopy } from './locale.js';
function singleLine(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/** 从工具输入中提取关键参数用于展示 */
function extractTarget(input, locale = 'zh-CN') {
    const labels = getUiCopy(locale).targetLabels;
    if (typeof input.command === 'string')
        return { key: labels.command, value: singleLine(input.command) };
    if (typeof input.file_path === 'string')
        return { key: labels.file, value: singleLine(input.file_path) };
    if (typeof input.path === 'string')
        return { key: labels.path, value: singleLine(input.path) };
    if (typeof input.pattern === 'string')
        return { key: labels.pattern, value: singleLine(input.pattern) };
    return null;
}
/** 从工具输入推导 glob 规则 */
export function deriveRule(toolName, input) {
    if (typeof input.command === 'string') {
        // bash(npm *) — 取第一个 token 作为前缀
        const firstToken = input.command.split(/\s+/)[0];
        if (firstToken)
            return `${toolName}(${firstToken} *)`;
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
export function buildPermissionRequest(toolName, input) {
    const target = extractTarget(input);
    return {
        toolName,
        summary: target ? `${toolName}: ${target.value}` : toolName,
        input,
        rule: deriveRule(toolName, input),
    };
}
export function formatPermissionDecisionSummary(_choice) {
    return '';
}
function compactRuleForOption(rule, maxLength = 72) {
    if (rule.length <= maxLength)
        return rule;
    const openParen = rule.indexOf('(');
    const closeParen = rule.lastIndexOf(')');
    if (openParen < 0 || closeParen <= openParen) {
        return `${rule.slice(0, maxLength - 3)}...`;
    }
    const prefix = rule.slice(0, openParen + 1);
    const suffix = rule.slice(closeParen);
    const inner = rule.slice(openParen + 1, closeParen);
    const availableInner = maxLength - prefix.length - suffix.length - 3;
    if (availableInner <= 8) {
        return `${rule.slice(0, maxLength - 3)}...`;
    }
    const headLength = Math.ceil(availableInner / 2);
    const tailLength = Math.floor(availableInner / 2);
    return `${prefix}${inner.slice(0, headLength)}...${inner.slice(-tailLength)}${suffix}`;
}
export function buildPermissionPromptOptions(rule) {
    const displayRule = compactRuleForOption(rule);
    return [
        { label: '允许一次', choice: { action: 'allow_once' } },
        { label: `本次会话始终允许 ${displayRule}`, choice: { action: 'allow_session', rule } },
        { label: `始终允许 ${displayRule} (保存到项目)`, choice: { action: 'allow_project', rule } },
        { label: `始终允许 ${displayRule} (保存到全局)`, choice: { action: 'allow_global', rule } },
        { label: '拒绝', choice: { action: 'deny' } },
    ];
}
export function formatPermissionPromptLines(toolName, input, options, locale = 'zh-CN') {
    const copy = getUiCopy(locale);
    const target = extractTarget(input, locale);
    const lines = [
        `${yellow('⚡')} ${copy.approvalTitle}`,
        `${copy.toolLabel}: ${boldCyan(toolName)}`,
    ];
    if (target) {
        lines.push(`${target.key}: ${dim(target.value)}`);
    }
    for (const option of options) {
        lines.push(option.selected ? boldCyan(`❯ ${option.label}`) : dim(`  ${option.label}`));
    }
    lines.push(dim(copy.hint));
    return lines;
}
/**
 * 交互式权限确认选择器。
 * 显示工具信息 + 箭头键可选的多行选项列表。
 */
export async function showPermissionPrompt(toolName, input, config) {
    const rule = deriveRule(toolName, input);
    const transcriptLogger = config?.transcriptLogger;
    const renderer = config?.renderer;
    const useRenderer = Boolean(renderer &&
        (renderer.hasActiveScrollRegion() ||
            renderer.getState().prompt !== '' ||
            renderer.getState().input.value !== ''));
    const promptOptions = buildPermissionPromptOptions(rule);
    // 非 TTY 环境下默认拒绝
    if (!stdin.isTTY) {
        return { action: 'deny' };
    }
    let selectedIdx = 0;
    return new Promise((resolve) => {
        let resolved = false;
        transcriptLogger?.record({ type: 'permission_prompt_open', toolName, timestamp: Date.now() });
        const renderAll = () => {
            const lines = formatPermissionPromptLines(toolName, input, promptOptions.map((option, idx) => ({ label: option.label, selected: idx === selectedIdx })));
            if (useRenderer && renderer) {
                if (renderer.hasActiveScrollRegion()) {
                    const currentState = renderer.getState();
                    renderer.renderInput({
                        prompt: currentState.prompt || 'Type your message...',
                        input: '',
                        cursor: 0,
                        footerLines: currentState.footerLines,
                        overlayLines: [],
                    });
                }
                renderer.openPermissionModal({
                    toolName,
                    targetLines: lines.slice(2, lines.length - (promptOptions.length + 1)),
                    options: promptOptions.map((option) => option.label),
                });
                for (let index = 0; index < selectedIdx; index += 1) {
                    renderer.handleKey('\x1b[B');
                }
                return;
            }
            for (const line of lines) {
                stdout.write(line + '\n');
            }
            stdout.write(`\x1b[${lines.length}A\r`);
        };
        const clearAll = () => {
            if (useRenderer && renderer) {
                const currentState = renderer.getState();
                if (renderer.hasActiveScrollRegion()) {
                    const preserveFooter = !(process.platform === 'win32' && process.env.TMUX);
                    if (process.platform === 'win32' && process.env.TMUX) {
                        renderer.clearVisibleContent();
                    }
                    renderer.renderInput({
                        prompt: currentState.prompt || 'Type your message...',
                        input: '',
                        cursor: 0,
                        footerLines: preserveFooter ? currentState.footerLines : [],
                        overlayLines: [],
                    });
                }
                else {
                    renderer.closeModal();
                }
                return;
            }
            const totalLines = formatPermissionPromptLines(toolName, input, promptOptions.map((option, idx) => ({ label: option.label, selected: idx === selectedIdx }))).length;
            stdout.write('\x1b7'); // save cursor
            for (let i = 0; i < totalLines; i++) {
                stdout.write('\x1b[2K');
                if (i < totalLines - 1) {
                    stdout.write('\x1b[B\r');
                }
            }
            stdout.write('\x1b8'); // restore cursor
        };
        const done = (choice) => {
            if (resolved)
                return;
            resolved = true;
            clearAll();
            stdin.removeListener('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            const summary = formatPermissionDecisionSummary(choice);
            if (summary) {
                stdout.write(`${dim(summary)}\n`);
            }
            resolve(choice);
        };
        const onData = (data) => {
            const key = data.toString('utf8');
            // Ctrl-C / Esc → 拒绝
            if (key === '\x03' || key === '\x1b') {
                done({ action: 'deny' });
                return;
            }
            // Enter → 选择当前项
            if (key === '\r' || key === '\n') {
                transcriptLogger?.record({
                    type: 'permission_prompt_decision',
                    action: promptOptions[selectedIdx].choice.action,
                    timestamp: Date.now(),
                });
                done(promptOptions[selectedIdx].choice);
                return;
            }
            // Up arrow
            if (key === '\x1b[A') {
                transcriptLogger?.record({ type: 'permission_prompt_navigate', direction: 'up', timestamp: Date.now() });
                selectedIdx = (selectedIdx - 1 + promptOptions.length) % promptOptions.length;
                if (useRenderer && renderer) {
                    renderer.handleKey('\x1b[A');
                }
                else {
                    clearAll();
                    renderAll();
                }
                return;
            }
            // Down arrow
            if (key === '\x1b[B') {
                transcriptLogger?.record({ type: 'permission_prompt_navigate', direction: 'down', timestamp: Date.now() });
                selectedIdx = (selectedIdx + 1) % promptOptions.length;
                if (useRenderer && renderer) {
                    renderer.handleKey('\x1b[B');
                }
                else {
                    clearAll();
                    renderAll();
                }
                return;
            }
        };
        renderAll();
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}
