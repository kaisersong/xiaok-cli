#!/usr/bin/env node
// 测试首次渲染 vs 第二次渲染

import { TerminalRenderer } from './dist/ui/terminal-renderer.js';
import { buildTerminalFrame } from './dist/ui/terminal-frame.js';

const renderer = new TerminalRenderer(process.stdout);

// 模拟真实的交互流程
console.log('\n=== 模拟欢迎屏幕 ===');
console.log('欢迎使用 xiaok code!');
console.log('Session: test-123');
console.log('───────────────────────\n');

// 等待一下让用户看到当前状态
await new Promise(r => setTimeout(r, 500));

// 首次渲染输入栏
console.log('=== 首次渲染 (previousLineCount = 0) ===');
const state1 = {
  prompt: '> ',
  transcript: [],
  input: { value: '', cursorOffset: 0, history: [] },
  footerLines: ['  xiaok-cli · claude-sonnet-4 · 1%'],
  overlay: null,
  modal: null,
  focusTarget: 'input',
  terminalSize: { columns: process.stdout.columns ?? 80, rows: 24 },
};

renderer.render(state1);

// 等待用户输入
await new Promise(r => setTimeout(r, 2000));

// 模拟用户输入一个字符后重新渲染
console.log('\n\n=== 第二次渲染 (previousLineCount = 2) ===');
const state2 = {
  ...state1,
  input: { value: 'a', cursorOffset: 1, history: [] },
};

renderer.render(state2);

await new Promise(r => setTimeout(r, 2000));

// 清理
renderer.clearAll();
console.log('\n测试完成');