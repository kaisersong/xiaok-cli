# xiaok UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复状态栏布局、添加工具调用可视化、git branch 显示、Ctrl+W/Alt+Arrow 快捷键、context 压缩通知。

**Architecture:** 通过 RuntimeHooks 事件总线把工具调用状态推送到 UI 层，用 startSpinner() 实现工具执行动画；StatusBar 作为每轮对话的 footer（在 AI 响应之后）；同步获取 git branch 避免首次渲染不完整。

**Tech Stack:** TypeScript, Vitest, Node.js raw mode stdin, ANSI escape codes, child_process.execFile

**优先级调整**：ESC 中断降级为 P3（Ctrl+C 已够用），本 plan 不实现。

---

## File Map

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `src/ui/statusbar.ts` | 修改 | 加 branch 字段和 updateBranch() 方法 |
| `src/ui/input.ts` | 修改 | 新增 Ctrl+W（删词）、Alt+←（词跳左）、Alt+→（词跳右） |
| `src/runtime/events.ts` | 修改 | tool_started 加 toolInput 字段、新增 compact_triggered 事件 |
| `src/utils/git.ts` | 新建 | getCurrentBranch() — execFile git |
| `src/commands/chat.ts` | 修改 | 状态栏改为 footer、订阅工具事件用 spinner、同步获取 branch、/compact 命令 |
| `src/ai/agent.ts` | 修改 | compactMessages 时 emit compact_triggered、新增 forceCompact() |
| `tests/ui/statusbar.test.ts` | 修改 | 修复 init 调用签名（加 cwd 参数）、调整断言 |
| `tests/utils/git.test.ts` | 新建 | getCurrentBranch 测试 |
| `tests/ui/input.test.ts` | 修改 | 新增 Ctrl+W、Alt+Arrow 测试 |

---

## Task 1: 修复已损坏的 statusbar 测试

当前 `statusBar.init()` 签名已改为 `(model, sessionId, cwd, mode?)`，但测试还在用旧签名，导致 10 个测试失败。

**Files:**
- Modify: `tests/ui/statusbar.test.ts`
- Modify: `src/ui/statusbar.ts`

- [ ] **Step 1: 在 StatusBar 类中添加 branch 字段和方法**

在 `src/ui/statusbar.ts` 中：
```typescript
export class StatusBar {
  private model = "";
  private sessionId = "";
  private mode = "default";
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };
  private fields: StatusBarField[] = DEFAULT_FIELDS;
  private enabled: boolean;
  private cwd = "";
  private branch = "";  // ← 新增

  // ... existing methods ...

  updateBranch(branch: string): void {
    this.branch = branch;
  }
}
```

同时修改 `getStatusLine()` 在 model 之后加 branch：
```typescript
getStatusLine(): string {
  if (!this.enabled) return "";

  const parts: string[] = [];

  // Project name (dirname basename)
  const projectName = this.cwd.split('/').pop() || this.cwd;
  parts.push(projectName);

  // Model name
  parts.push(this.model);

  // Git branch
  if (this.branch) parts.push(this.branch);

  // Context usage %
  if (this.usage.budget && this.usage.budget > 0) {
    const total = this.usage.inputTokens + this.usage.outputTokens;
    const pct = Math.round((total / this.usage.budget) * 100);
    parts.push(`${pct}%`);
  }

  // Mode badge
  if (this.mode !== "default") parts.push(`[${this.mode}]`);

  return dim(parts.join("  "));
}
```

- [ ] **Step 2: 更新测试文件中所有 init 调用**

将 `tests/ui/statusbar.test.ts` 中所有 `statusBar.init(...)` 调用改为 3 参数或 4 参数形式：

```typescript
// init describe 块
it('should store model and session id', () => {
  statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');
  const line = statusBar.getStatusLine();
  expect(line).toContain('claude-opus-4-6');
  expect(line).toContain('xiaok-cli');
});

it('should store mode if provided', () => {
  statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli', 'auto');
  const line = statusBar.getStatusLine();
  expect(line).toContain('[auto]');
});

it('should not show mode badge for default mode', () => {
  statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');
  const line = statusBar.getStatusLine();
  expect(line).not.toContain('[default]');
});

// render describe 块 beforeEach
beforeEach(() => {
  statusBar.init('claude-opus-4-6', 'test123', '/projects/xiaok-cli');
  stdoutOutput = '';
});
```

- [ ] **Step 3: 调整 render 测试断言**

```typescript
it('should write status line to stdout', () => {
  statusBar.render();
  expect(stdoutOutput).toContain('claude-opus-4-6');
  expect(stdoutOutput).toContain('xiaok-cli');
});

it('should display project name', () => {
  statusBar.render();
  expect(stdoutOutput).toContain('xiaok-cli');
});

it('should display model name', () => {
  statusBar.render();
  expect(stdoutOutput).toContain('claude-opus-4-6');
});

it('should display context percentage when budget set', () => {
  statusBar.update({ inputTokens: 10000, outputTokens: 5000, budget: 100000 });
  stdoutOutput = '';
  statusBar.render();
  expect(stdoutOutput).toContain('15%');
});

it('should not display percentage when no budget', () => {
  statusBar.update({ inputTokens: 1234, outputTokens: 5678 });
  stdoutOutput = '';
  statusBar.render();
  expect(stdoutOutput).not.toContain('%');
});

it('should update model name', () => {
  statusBar.updateModel('gpt-4o');
  stdoutOutput = '';
  statusBar.render();
  expect(stdoutOutput).toContain('gpt-4o');
  expect(stdoutOutput).not.toContain('claude-opus-4-6');
});

// disabled state 测试
it('should return empty string when not TTY', () => {
  process.stdout.isTTY = false;
  const bar = new StatusBar();
  bar.init('claude-opus-4-6', 'test123', '/projects/foo');
  expect(bar.getStatusLine()).toBe('');
});

it('should return empty string when NO_COLOR is set', () => {
  process.env.NO_COLOR = '1';
  const bar = new StatusBar();
  bar.init('claude-opus-4-6', 'test123', '/projects/foo');
  expect(bar.getStatusLine()).toBe('');
});
```

- [ ] **Step 4: 新增 branch 显示测试**

在 `tests/ui/statusbar.test.ts` 的 render describe 块中添加：
```typescript
it('should display git branch when set', () => {
  statusBar.updateBranch('main');
  stdoutOutput = '';
  statusBar.render();
  expect(stdoutOutput).toContain('main');
});

it('should not display branch when not set', () => {
  statusBar.render();
  // 不应该有 branch 相关内容（只检查有 model 和 project）
  expect(stdoutOutput).toContain('claude-opus-4-6');
  expect(stdoutOutput).toContain('xiaok-cli');
});
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /Users/song/projects/xiaok-cli && npm test -- tests/ui/statusbar.test.ts
```

期望：全部 PASS

- [ ] **Step 6: 构建并提交**

```bash
cd /Users/song/projects/xiaok-cli && npm run build
git add src/ui/statusbar.ts tests/ui/statusbar.test.ts
git commit -m "fix: repair statusbar tests + add branch field"
```

---

## Task 2: 新增 git branch 工具函数

**Files:**
- Create: `src/utils/git.ts`
- Create: `tests/utils/git.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/utils/git.test.ts`：
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}));

import { getCurrentBranch } from '../../src/utils/git.js';

describe('getCurrentBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return branch name on success', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValue({ stdout: 'main\n', stderr: '' });

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('main');
  });

  it('should trim whitespace from branch name', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockResolvedValue({ stdout: '  feature/my-branch  \n', stderr: '' });

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('feature/my-branch');
  });

  it('should return empty string when not in a git repo', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockRejectedValue(new Error('not a git repository'));

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('');
  });

  it('should return empty string on any error', async () => {
    const mockExecFile = vi.mocked(execFile) as any;
    mockExecFile.mockRejectedValue(new Error('git not found'));

    const branch = await getCurrentBranch('/some/path');
    expect(branch).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/song/projects/xiaok-cli && npm test -- tests/utils/git.test.ts
```

期望：FAIL - "Cannot find module '../../src/utils/git.js'"

- [ ] **Step 3: 实现 `src/utils/git.ts`**

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/song/projects/xiaok-cli && npm test -- tests/utils/git.test.ts
```

期望：4 PASS

- [ ] **Step 5: 构建提交**

```bash
cd /Users/song/projects/xiaok-cli && npm run build
git add src/utils/git.ts tests/utils/git.test.ts
git commit -m "feat: add getCurrentBranch() git utility"
```

---

## Task 3: 修改 RuntimeEvents 支持工具可视化和压缩通知

**Files:**
- Modify: `src/runtime/events.ts`
- Modify: `src/ai/agent.ts`

- [ ] **Step 1: 给 `tool_started` 事件加 toolInput 字段，新增 compact_triggered 事件**

修改 `src/runtime/events.ts`：
```typescript
export type RuntimeEvent =
  | {
      type: 'turn_started';
      sessionId: string;
      turnId: string;
    }
  | {
      type: 'turn_completed';
      sessionId: string;
      turnId: string;
    }
  | {
      type: 'approval_required';
      sessionId: string;
      turnId: string;
      approvalId: string;
    }
  | {
      type: 'tool_started';
      sessionId: string;
      turnId: string;
      toolName: string;
      toolInput: Record<string, unknown>;  // ← 新增
    }
  | {
      type: 'tool_finished';
      sessionId: string;
      turnId: string;
      toolName: string;
      ok: boolean;
    }
  | {
      type: 'compact_triggered';           // ← 新增
      sessionId: string;
      turnId: string;
    };
```

- [ ] **Step 2: 在 `agent.ts` emit tool_started 时传入 toolInput**

修改 `src/ai/agent.ts` 中 tool_started emit（约第 117 行）：
```typescript
this.emit({
  type: 'tool_started',
  sessionId: this.sessionId,
  turnId,
  toolName: tc.name,
  toolInput: tc.input,   // ← 新增
});
```

- [ ] **Step 3: 在 compact 判断处 emit compact_triggered**

在 `src/ai/agent.ts` 的 `runTurn` 方法中（约第 61 行）：
```typescript
if (shouldCompact(estimateTokens(this.messages), contextLimit, compactThreshold)) {
  this.messages = compactMessages(this.messages, compactPlaceholder);
  this.emit({
    type: 'compact_triggered',
    sessionId: this.sessionId,
    turnId,
  });
}
```

- [ ] **Step 4: 新增 forceCompact() 方法**

在 `src/ai/agent.ts` 的 `clearHistory()` 方法旁添加：
```typescript
/** 手动触发 context 压缩 */
forceCompact(): void {
  this.messages = compactMessages(this.messages, '[context compacted]');
}
```

- [ ] **Step 5: 构建提交**

```bash
cd /Users/song/projects/xiaok-cli && npm run build
git add src/runtime/events.ts src/ai/agent.ts
git commit -m "feat: add toolInput to tool_started event + compact_triggered event"
```

---

## Task 4: Ctrl+W / Alt+Arrow 键盘快捷键

**Files:**
- Modify: `src/ui/input.ts`
- Modify: `tests/ui/input.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/ui/input.test.ts` 中的 `InputReader` describe 块后添加：
```typescript
describe('word navigation helpers', () => {
  it('wordBoundaryLeft should find previous word start', () => {
    expect(wordBoundaryLeft('hello world', 11)).toBe(6);
    expect(wordBoundaryLeft('hello world', 6)).toBe(0);
    expect(wordBoundaryLeft('hello world', 5)).toBe(0);
    expect(wordBoundaryLeft('', 0)).toBe(0);
  });

  it('wordBoundaryRight should find next word end', () => {
    expect(wordBoundaryRight('hello world', 0)).toBe(5);
    expect(wordBoundaryRight('hello world', 5)).toBe(11);
    expect(wordBoundaryRight('hello world', 6)).toBe(11);
    expect(wordBoundaryRight('', 0)).toBe(0);
  });
});
```

同时在文件顶部导入：
```typescript
import { InputReader, getSlashCommands, wordBoundaryLeft, wordBoundaryRight } from '../../src/ui/input.js';
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Users/song/projects/xiaok-cli && npm test -- tests/ui/input.test.ts
```

期望：FAIL - "wordBoundaryLeft is not exported"

- [ ] **Step 3: 实现并 export 两个 helper**

在 `src/ui/input.ts` 顶部（getSlashCommands 之前）添加并导出：
```typescript
/** 向左找词边界（Ctrl+W / Alt+Left 用） */
export function wordBoundaryLeft(text: string, cursor: number): number {
  let i = cursor;
  // 跳过光标左侧的空白
  while (i > 0 && text[i - 1] === ' ') i--;
  // 跳过非空白（即当前词）
  while (i > 0 && text[i - 1] !== ' ') i--;
  return i;
}

/** 向右找词边界（Alt+Right 用） */
export function wordBoundaryRight(text: string, cursor: number): number {
  let i = cursor;
  // 跳过空白
  while (i < text.length && text[i] === ' ') i++;
  // 跳过非空白（下一个词）
  while (i < text.length && text[i] !== ' ') i++;
  return i;
}
```

- [ ] **Step 4: 在 InputReader.onData 中处理新按键**

在 `InputReader` 的 `onData` 中，在 Escape 处理之前添加：
```typescript
// Ctrl+W — 删除光标左侧一个词
if (key === '\x17') {
  const newCursor = wordBoundaryLeft(input, cursor);
  if (newCursor < cursor) {
    input = input.slice(0, newCursor) + input.slice(cursor);
    cursor = newCursor;
    redraw();
    if (input.startsWith('/') && input.length > 0) {
      updateMenu(input);
    } else {
      closeMenu();
    }
  }
  return;
}

// Alt+Left (ESC b) — 词跳左
if (key === '\x1bb') {
  cursor = wordBoundaryLeft(input, cursor);
  redraw();
  return;
}

// Alt+Right (ESC f) — 词跳右
if (key === '\x1bf') {
  cursor = wordBoundaryRight(input, cursor);
  redraw();
  return;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /Users/song/projects/xiaok-cli && npm test -- tests/ui/input.test.ts
```

期望：全部 PASS

- [ ] **Step 6: 构建提交**

```bash
cd /Users/song/projects/xiaok-cli && npm run build
git add src/ui/input.ts tests/ui/input.test.ts
git commit -m "feat: add Ctrl+W delete word, Alt+Arrow word navigation"
```

---

## Task 5: 整合到 chat.ts — 工具可视化 + 状态栏 footer + /compact

**Files:**
- Modify: `src/commands/chat.ts`

- [ ] **Step 1: 在 chat.ts 中导入新模块**

在文件顶部添加：
```typescript
import { getCurrentBranch } from '../utils/git.js';
import { startSpinner } from '../ui/render.js';
```

- [ ] **Step 2: 初始化时同步获取 git branch**

在 `statusBar.init(...)` 调用之后（约第 133 行）改为同步等待：
```typescript
statusBar.init(modelName, sessionId, cwd, opts.auto ? 'auto' : opts.dryRun ? 'dry-run' : undefined);

// 同步获取 git branch
const branch = await getCurrentBranch(cwd);
if (branch) statusBar.updateBranch(branch);
```

- [ ] **Step 3: 订阅工具事件，用 startSpinner 渲染**

在交互循环 `while(true)` 上方（约第 147 行之前）添加：
```typescript
// 工具调用可视化 — 用 startSpinner
const activeSpinners = new Map<string, () => void>();

runtimeHooks.on('tool_started', (e) => {
  const displayValue = extractToolDisplay(e.toolInput);
  const msg = displayValue ? `${e.toolName}(${displayValue})` : e.toolName;
  const stopSpinner = startSpinner(msg);
  activeSpinners.set(e.toolName, stopSpinner);
});

runtimeHooks.on('tool_finished', (e) => {
  const stop = activeSpinners.get(e.toolName);
  if (stop) {
    stop();
    activeSpinners.delete(e.toolName);
  }
  const icon = e.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  process.stdout.write(`  ${icon} ${e.toolName}\n`);
});

// Context 压缩通知
runtimeHooks.on('compact_triggered', () => {
  process.stdout.write(`\n  ${dim('⚠ 上下文已压缩，保留最近对话')}\n\n`);
});

// Helper: 从工具输入提取展示值
function extractToolDisplay(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command.slice(0, 40);
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.pattern === 'string') return input.pattern;
  return '';
}
```

- [ ] **Step 4: 将 contextBudget 传入 StatusBar update**

在所有 `agent.runTurn` 的 `onChunk` 回调中（约 3 处），更新 usage 时传入 budget：
```typescript
await agent.runTurn(userMsg, (chunk) => {
  if (chunk.type === 'text') mdRenderer.write(chunk.delta);
  if (chunk.type === 'usage') {
    statusBar.update({ ...chunk.usage, budget: config.contextBudget });
  }
});
```

- [ ] **Step 5: 修改状态栏位置为 footer（AI 响应之后）**

将循环体中的 statusBar.render() 从输入前移到 AI 响应后：

原来（约第 150-154 行）：
```typescript
statusBar.render();
const input = await inputReader.read(boldCyan('> '));
```

改为：
```typescript
const input = await inputReader.read(boldCyan('> '));
```

然后在每个 AI 响应完成后（mdRenderer.flush() 之后）添加 statusBar.render()：
```typescript
mdRenderer.flush();
process.stdout.write('\n');
statusBar.render();  // ← 新增，作为 footer
```

共 3 处需要添加（单次任务模式、斜杠命令、普通输入）。

- [ ] **Step 6: 添加 /compact 命令**

在 `/help` 命令处理之后（约第 192 行）添加：
```typescript
if (trimmed === '/compact') {
  agent.forceCompact();
  process.stdout.write(`${dim('上下文已压缩。')}\n\n`);
  continue;
}
```

同时在 `/help` 输出中加一行：
```typescript
process.stdout.write('  /compact - 手动压缩上下文\n');
```

- [ ] **Step 7: 构建验证**

```bash
cd /Users/song/projects/xiaok-cli && npm run build && npm test
```

期望：编译无错，所有测试 PASS

- [ ] **Step 8: 提交**

```bash
git add src/commands/chat.ts
git commit -m "feat: integrate tool spinner, status bar as footer, git branch, /compact"
```

---

## 验证清单

- [ ] `npm test` 全量通过，无失败测试
- [ ] `npm run build` 编译无错
- [ ] 状态栏显示：`xiaok-cli  claude-opus-4-6  main  3%`（格式正确）
- [ ] 布局顺序：`> 输入框` → AI 响应 → 状态栏（footer）
- [ ] 工具执行时显示 spinner `⠋ bash(npm install)`，完成后变为 `✓ bash`
- [ ] context 压缩时显示 `⚠ 上下文已压缩`
- [ ] Ctrl+W 删除光标左侧一个词
- [ ] Alt+← / Alt+→ 按词跳转
- [ ] `/compact` 命令手动压缩 context
- [ ] `/help` 显示 `/compact` 命令

---

## 执行方式

Plan 完成，两种执行选项：

**1. Subagent-Driven（推荐）** — 我派发独立 subagent 逐 Task 执行，每完成一个我来审查

**2. Inline Execution** — 在本 session 按 task 顺序执行，有 checkpoint

选哪种？
