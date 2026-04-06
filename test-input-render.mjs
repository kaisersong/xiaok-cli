#!/usr/bin/env node
// 实际测试 xiaok 输入栏渲染

import { writeFileSync, appendFileSync } from 'node:fs';
import { renderInputSeparator, dim } from './dist/ui/render.js';
import { ReplRenderer } from './dist/ui/repl-renderer.js';

const DEBUG_LOG = '/tmp/xiaok-render-debug.log';
writeFileSync(DEBUG_LOG, '');

function log(msg) {
  appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

log('=== Test start ===');

// 模拟 chat.ts 的流程
const renderer = new ReplRenderer(process.stdout);

// 模拟欢迎屏幕
console.log();
console.log(dim('╭──────────────────────────────────────────────────────────────╮'));
console.log(dim('│') + '              欢迎使用 xiaok code!              ' + dim('│'));
console.log(dim('╰──────────────────────────────────────────────────────────────╯'));
console.log();

log('Welcome screen printed');

// 模拟分隔线
renderInputSeparator();

log('Separator printed');

// 等待一下
await new Promise(r => setTimeout(r, 500));

// 首次渲染输入栏
log('First render input');
renderer.renderInput({
  prompt: '> ',
  input: '',
  cursor: 0,
  footerLines: ['  xiaok-cli · claude-sonnet-4 · 1%'],
  overlayLines: [],
});

log('First render done');

// 等待 2 秒
await new Promise(r => setTimeout(r, 2000));

// 模拟用户输入一个字符
log('Second render with input "a"');
renderer.renderInput({
  prompt: '> ',
  input: 'a',
  cursor: 1,
  footerLines: ['  xiaok-cli · claude-sonnet-4 · 1%'],
  overlayLines: [],
});

log('Second render done');

// 等待 2 秒
await new Promise(r => setTimeout(r, 2000));

// 清理
log('Clear all');
renderer.prepareBlockOutput();

log('Test done');
console.log('\n\n=== Test complete. Check log at /tmp/xiaok-render-debug.log ===');