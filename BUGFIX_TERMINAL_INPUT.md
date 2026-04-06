# Terminal Input Bar Rendering Bug Fix

## 问题现象

1. **首次进入时输入栏缺失**：启动 xiaok 后，输入栏的提示符和背景色不显示，需要输入一个字符后才恢复
2. **提交后残留旧输入**：用户提交输入后，旧的输入内容没有被清除，残留在屏幕上

## 根因分析

### 问题 1：首次渲染无背景

**原因**：`stdin.setRawMode(true)` 在 `redraw()` 之后调用

```typescript
// 错误顺序
if (this.renderer) {
  redraw();  // 先渲染
}
stdin.setRawMode(true);  // 后设置 raw mode
```

在某些终端环境下，如果终端不在 raw mode，ANSI 渲染序列可能不会正确处理。

**修复**：将 `setRawMode` 移到 `redraw()` 之前

```typescript
// 正确顺序
if (this.renderer) {
  stdin.setRawMode(true);  // 先设置 raw mode
  redraw();  // 再渲染
}
```

### 问题 2：提交后输入残留

**原因**：`prepareBlockOutput()` 调用 `clearPromptLine()`，这会渲染一个空的提示行

```typescript
// 错误做法
prepareBlockOutput(): void {
  this.clearPromptLine();  // 渲染空提示行，设置 previousLineCount = 1
}
```

问题链：
1. `clearPromptLine()` 渲染空提示行，`previousLineCount = 1`
2. AI 输出内容，光标移动到新位置
3. 下次 `redraw()` 时，从当前光标位置向上清除 1 行
4. 但当前光标位置已经不是输入栏的位置了
5. 结果：清除错误的位置，旧输入残留

**修复**：`prepareBlockOutput()` 应该清除输入行，而不是渲染空提示

```typescript
// 正确做法
prepareBlockOutput(): void {
  this.terminalRenderer.clearAll();  // 清除已渲染的输入行
}
```

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/ui/input.ts` | 将 `setRawMode` 移到 `redraw()` 之前 |
| `src/ui/repl-renderer.ts` | `prepareBlockOutput()` 改用 `clearAll()` |
| `src/ui/terminal-renderer.ts` | 添加 `clearAll()` 方法 |

## 经验教训

### 1. 终端渲染状态管理

终端渲染是**位置敏感**的操作：
- `previousLineCount` 记录了当前渲染区域的高度
- 下次渲染时，需要从**正确的光标位置**开始清除
- 任何中间操作（如 AI 输出）都会改变光标位置

**规则**：如果在渲染区域外有输出，必须重置渲染状态

### 2. Raw Mode 时机

`stdin.setRawMode(true)` 影响：
- 禁用行缓冲
- 禁用回显
- 改变终端对特殊字符的处理

**规则**：在渲染 ANSI 序列前设置 raw mode，确保终端行为一致

### 3. 调试终端 UI 的方法

1. **日志法**：在关键函数添加日志，记录 `previousLineCount` 和光标位置
2. **模拟法**：创建 `MockTerminal` 类，追踪每个 ANSI 序列的效果
3. **隔离法**：单独测试渲染函数，排除其他因素

## 防止复发

### 代码审查要点

- [ ] 任何 `render()` 调用前，确认终端状态正确
- [ ] 任何改变光标位置的操作后，检查是否需要重置渲染状态
- [ ] `prepareBlockOutput` 类函数应该是**清除**而不是**渲染空白**

### 测试场景

- [ ] 启动后立即检查输入栏背景
- [ ] 提交输入后检查是否有残留
- [ ] AI 回复后检查新输入栏是否正常
- [ ] 连续多轮对话测试

## 相关提交

- Commit: fix: terminal input bar rendering issues
- Date: 2026-04-06