# xiaok CLI 菜单显示问题分析

## 问题描述

用户输入 `/` 后，菜单没有显示在屏幕上，光标位置异常（显示在屏幕中间）。

## 日志分析

从 `/tmp/xiaok-debug.log` 看到：

```
2026-03-30T13:43:44.601Z key pressed: "/" input="" cursor=0
2026-03-30T13:43:44.602Z openMenu: text="/"
2026-03-30T13:43:44.610Z openMenu: filtered items=12
2026-03-30T13:43:44.610Z renderMenu: items=12 idx=0
```

**关键发现：**
1. ✅ 按键被正确捕获：`key pressed: "/"`
2. ✅ openMenu 被调用：`openMenu: text="/"`
3. ✅ 过滤到 12 个命令：`filtered items=12`
4. ✅ renderMenu 被调用：`renderMenu: items=12 idx=0`

**结论：菜单逻辑完全正常，问题在于渲染输出被干扰了。**

## 问题根源

### 1. 状态栏的 ANSI 转义序列干扰

查看 `src/ui/statusbar.ts` 的 `render()` 方法：

```typescript
render(): void {
  const rows = process.stdout.rows ?? 24;
  // 保存当前光标位置
  process.stdout.write('\x1b[s');
  // 移动到最后一行渲染状态栏
  process.stdout.write(`\x1b[${rows};1H\x1b[K`);
  process.stdout.write(statusLine);
  // 恢复光标位置
  process.stdout.write('\x1b[u');
}
```

**问题：**
- `\x1b[s` 和 `\x1b[u` 保存/恢复光标位置
- 这会干扰 `input.ts` 中菜单的光标操作
- 菜单使用 `\x1b[${this.menuItems.length}A` 向上移动光标
- 两者冲突导致光标位置混乱

### 2. 欢迎界面的 ANSI 定位

查看欢迎界面输出：
```
[22;1H[K[2m──────────────────────────────────────────────────────────────────────────────[0m
[23;1H[K[1;36m> [0m
```

欢迎界面使用了绝对定位（`[22;1H`, `[23;1H`），这也会影响后续的输入框位置。

## 排查思路

### 第一步：确认菜单逻辑是否工作 ✅
- [x] 添加调试日志记录按键、openMenu、renderMenu
- [x] 确认日志显示逻辑正常执行
- **结果：逻辑完全正常**

### 第二步：检查 ANSI 转义序列冲突 ⬅️ 当前位置
- [ ] 禁用状态栏的 ANSI 定位，改为简单文本输出
- [ ] 检查欢迎界面是否干扰输入框
- [ ] 验证菜单是否正常显示

### 第三步：修复方案

#### 方案 A：状态栏改为简单文本输出（已尝试但未完全实现）
```typescript
// 在 chat.ts 中，不调用 statusBar.render()
// 而是直接输出文本
const statusLine = statusBar.getStatusLine();
if (statusLine) process.stdout.write(statusLine + '\n');
```

**问题：** 这样状态栏就不是固定在底部了，而是跟在 AI 响应后面。

#### 方案 B：输入框避开状态栏区域
```typescript
// 在 input.ts 中，计算可用行数时减去状态栏占用的行
const availableRows = (process.stdout.rows ?? 24) - 1; // 减去底部状态栏
```

#### 方案 C：完全禁用状态栏的实时渲染
```typescript
// 只在 AI 响应完成后输出一次状态栏，不使用固定定位
// 在等待用户输入时不渲染状态栏
```

## 下一步行动

1. **立即测试：** 完全移除状态栏的 ANSI 定位，改为简单文本输出
2. **验证：** 输入 `/` 检查菜单是否显示
3. **如果还有问题：** 检查欢迎界面的 ANSI 定位是否干扰

## 测试命令

```bash
# 清空日志
> /tmp/xiaok-debug.log

# 运行 xiaok
xiaok

# 输入 /
# 检查菜单是否显示

# 查看日志
cat /tmp/xiaok-debug.log
```

## 预期结果

输入 `/` 后应该看到：
```
> /
  ❯ /clear  Clear the screen
    /exit   Exit the chat
    /help   Show help
    /models Switch model
    ...
```

光标应该在 `/` 后面，菜单显示在输入框下方。
