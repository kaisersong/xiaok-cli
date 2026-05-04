# xiaok Desktop 测试计划

> **目标**：完备的功能测试方案，覆盖所有核心功能路径、边界情况和失败模式。
> **版本**：v2 — 整合 Codex 对抗性评审反馈（35 项发现）。

---

## 1. 测试环境

### 1.1 启动方式

```bash
# 方式一：完整 Electron 应用（推荐，P0 测试必须用此方式）
cd /Users/song/projects/xiaok-cli/desktop
npm run pack:dir
open release/mac-arm64/xiaok.app

# 方式二：Renderer 开发模式（仅 P1/P2 UI 测试，无法测试 IPC）
npm run dev
# 浏览器打开 http://127.0.0.1:5173
# 限制：无法测试 IPC 调用（createTask、selectMaterials 等）
```

### 1.2 前置条件

记录以下信息，确保测试可重复：

| 项 | 要求 | 记录值 |
|----|------|--------|
| App 版本 | `cat desktop/VERSION` 或 git SHA | ______ |
| Node/npm 版本 | `node -v && npm -v` | ______ |
| macOS 版本 | `sw_vers` | ______ |
| 架构 | arm64 / x64 | ______ |
| 数据状态 | 首次启动前清空 `~/Library/Application Support/xiaok-desktop/` 和 IndexedDB | ______ |

1. **Model Config 已配置** — 至少一个 provider 有 API Key
   - 检查：`~/.config/xiaok/model-config.json`
   - 或在 Settings > Providers 设置
   - **记录**：provider 名称、model ID、base URL

2. **Skill fixture** — 使用确定性的测试 skill，而非"任意 skill"
   - 创建 `~/.xiaok/skills/test-fixture/` 目录
   - SKILL.md 定义：trigger 为 `/test-fixture`，输出固定文本 `"FIXTURE_OK"`
   - 不使用网络、不使用工具

3. **网络可用** — 需要调用 LLM API
   - 离线测试场景需要能控制网络（关闭 WiFi 或 `networksetup`）

4. **测试数据** — 通过 UI 创建确定性数据，不直接操作 IndexedDB
   - 任务 A："Alpha task for search" — 标题包含 "Alpha"
   - 任务 B："Beta task for search" — 标题包含 "Beta"
   - 任务 C："Gamma 任务 中文测试" — 标题包含中文

---

## 2. 功能清单

| 模块 | 功能 | 优先级 |
|------|------|--------|
| **App Startup** | 打包应用启动、首屏渲染 | P0 |
| **IPC Bridge** | preload 可用性、请求/响应、订阅清理 | P0 |
| **ChatShell** | 任务生命周期、取消、失败、恢复 | P0 |
| **ChatView** | 消息流、进度、结果、Markdown 渲染 | P0 |
| **ChatInput** | 发送消息、附件上传/失败 | P0→P1 |
| **DesktopSettings** | Provider 配置、API Key 持久化 | P0 |
| **Failure Modes** | API 错误、断网、流中断、持久化失败 | P0 |
| **Tool Permissions** | 工具审批 allow/deny 流程 | P0 |
| **Sidebar** | 搜索、重命名、删除 | P1 |
| **WelcomePage** | 最近对话列表 | P1 |
| **Security** | API Key mask、preload 边界、外部链接 | P1 |
| **Window Lifecycle** | minimize/restore、Cmd+Q、多实例 | P2 |
| **Accessibility** | 键盘导航、焦点顺序 | P2 |

---

## 3. P0 核心功能测试

### 3.1 应用启动（Packaged App）

**前置**：清空 `~/Library/Application Support/xiaok-desktop/`、IndexedDB。

**测试步骤**：
1. 运行 `open release/mac-arm64/xiaok.app`
2. 等待窗口出现（≤5s）
3. 检查：
   - 窗口标题栏显示 "xiaok desktop"
   - 首页显示 "What do you want to build?"
   - Sidebar 显示 "No tasks yet"
   - 主进程无 console 错误（View → Toggle DevTools → Console）

**预期结果**：
- 窗口在 5s 内出现
- 渲染 WelcomePage 无白屏
- Console 0 errors, 0 warnings
- 只有一个 BrowserWindow（无重复窗口）

**边界测试**：
- 双击 app 图标：不打开第二个实例
- 已有实例运行时再次打开：focus 到已有窗口
- `~/Library/Application Support/` 不存在：自动创建

### 3.2 IPC Bridge 合约

**测试步骤**：
1. 打开 DevTools Console
2. 输入 `window.xiaokDesktop` 检查 preload 是否注入
3. 输入 `window.xiaokDesktop.getModelConfig()` 检查返回值
4. 输入 `window.xiaokDesktop.selectMaterials()` 取消选择
5. 输入 `window.xiaokDesktop.getActiveTask()` 检查空任务返回

**预期结果**：
- `window.xiaokDesktop` 不为 undefined
- `getModelConfig()` 返回包含 `providers` 数组的对象
- `selectMaterials()` 取消返回 `{ filePaths: [] }`
- `getActiveTask()` 返回 `null`

**边界测试**：
- `subscribeTask` 传入不存在的 taskId：不崩溃，返回 unsubscribe 函数
- `cancelTask` 传入不存在的 taskId：返回错误但不崩溃
- 快速连续调用 `createTask` 两次：第二次被拒绝或排队

### 3.3 发送消息（createTask + subscribeTask）

**测试步骤**：
1. 在首页输入框输入 "Write a hello world in Python"
2. 点击发送（Enter 或 Send 按钮）
3. 观察事件流：
   - `task_started` → status 变为 "Running"
   - `assistant_delta` → 文本逐步显示
   - `result` → status 变为 "Completed"，显示 summary

**预期结果**：
- 消息发送后 status 立即变为 "Running"（≤1s）
- Assistant 响应文本流式渲染，逐字追加（非一次性出现）
- 完成后显示 Result 卡片：
  - summary 文本非空
  - 如果有 artifacts，显示可点击的 artifact 列表
  - 如果无 artifacts，不显示 artifacts 区域
- 线程标题自动更新为 summary 前 40 字符（去除 markdown 语法）

**Markdown 渲染验证**（具体断言）：
- `# Heading` 渲染为 h1 字体大小
- `` `inline code` `` 渲染为等宽字体+背景色
- 代码块有语言标签、水平滚动、保留空格缩进
- `[link](url)` 渲染为可点击链接，点击在系统浏览器打开
- `- list item` 渲染为列表（非纯文本）
- 原始 HTML 被清理（不执行 `<script>`）

**边界测试**：
- 空消息：不发送，Send 按钮 disabled，输入框保持
- 超长消息（>10000 字）：发送成功，UI 无溢出
- 连续快速按 Enter：只发送一条（输入框清空后按钮 disabled）
- 空响应（assistant 无 delta）：显示无内容提示，status 仍 Completed
- 只含 `\n` 的响应：不崩溃

### 3.4 调用 Skill

**前置**：安装 test-fixture skill（trigger: `/test-fixture`，输出: `"FIXTURE_OK"`）。

**测试步骤**：
1. 输入：`/test-fixture hello`
2. 观察事件流

**预期结果**：
- Skill 识别后 progress 区域显示 "Using skill: test-fixture"（或等效信号）
- 执行完成后 assistant 响应包含 `"FIXTURE_OK"`
- 不出现错误提示

**边界测试**：
- 无 skill 目录（`~/.xiaok/skills/` 不存在）：降级为普通 LLM 对话，不崩溃
- Skill 执行报错（skill 脚本返回非零退出码）：显示具体错误信息，不崩溃，不卡在 Running
- 不存在的 skill 名称（`/nonexistent-skill`）：提示未找到，不崩溃
- Skill 输出包含 markdown：正确渲染

### 3.5 任务取消

**测试步骤**：
1. 输入一个会执行较久的任务（如 "Explain quantum computing in detail"）
2. 在 Running 状态时点击 Cancel 按钮
3. 观察状态变化

**预期结果**：
- 点击 Cancel 后 status 在 2s 内变为 "Idle"（不是 "Failed"）
- 已收到的 assistant delta 文本保留在屏幕上
- Cancel 按钮消失，ChatInput 重新出现
- Sidebar 中线程状态不显示 "running"

### 3.6 任务失败

**前置**：配置一个无效 API Key（随机字符串）。

**测试步骤**：
1. 输入 "hello"
2. 等待 API 返回 401 错误
3. 观察 UI 反应

**预期结果**：
- status 变为 "Failed"
- 显示用户可理解的错误信息（如 "API authentication failed"）
- 错误信息不包含 API Key 明文
- 不卡在 spinner/loading 状态
- ChatInput 重新出现，可发送新消息
- 可以重新配置正确的 API Key 后恢复

### 3.7 离线/断网

**测试步骤**：
1. 断开网络（关闭 WiFi）
2. 输入 "hello"
3. 观察超时/错误
4. 恢复网络
5. 再次发送消息

**预期结果**：
- 断网时发送消息：status 变为 "Failed"，显示网络错误
- 恢复网络后发送：正常工作
- 运行中断网：流停止，显示部分响应 + 错误提示

### 3.8 用户问答（NeedsUserQuestion）

**测试步骤**：
1. 输入一个需要澄清的任务
2. 等待 `needs_user` 事件
3. 观察问题卡片：显示 prompt 文本 + 可选 choices 按钮
4. 点击一个选项

**预期结果**：
- 问题显示为带边框卡片，prompt 文本可读
- choices 按钮垂直排列，可点击
- 点击后卡片消失，status 回到 Running
- 选择传递给后端（后续行为反映选择）

**边界测试**：
- 不回答直接关闭窗口再打开：任务恢复为 waiting_user 状态，问题重新显示
- 多个问题连续出现：逐个处理，前一个回答后才出现下一个
- 问题文本很长（>500 字）：UI 滚动显示，不溢出
- 问题文本包含 markdown：正确渲染

### 3.9 任务恢复（recoverTask）

**测试步骤**：
1. 开始一个任务并等待 Running 状态
2. 关闭应用窗口（Cmd+W）
3. 重新打开应用
4. 从 Sidebar 点击刚才的任务

**预期结果**：
- 如果任务仍在 running：自动恢复订阅，status 显示 Running
- 已收到的事件保留在屏幕上
- 如果任务已完成：显示完整结果，status 显示 Completed
- 如果任务已失败：显示错误信息

**边界测试**：
- 任务在关闭期间完成：打开后直接显示 Result
- 任务在关闭期间失败：打开后显示错误
- 后端进程已终止（app 完全退出后重开）：恢复失败时降级显示空白，不崩溃

### 3.10 工具权限审批

**测试步骤**：
1. 输入需要执行命令的任务（如 "list files in current directory"）
2. 等待工具权限请求
3. 点击 Allow

**预期结果**：
- 权限请求显示工具名称和参数
- Allow 后继续执行
- Deny 后任务失败并显示拒绝原因

**边界测试**：
- Cancel 权限请求（非 Allow/Deny）：任务取消
- 权限请求弹出时关闭窗口：重新打开后任务为 waiting 状态

### 3.11 DesktopSettings Providers

**测试步骤**：
1. 进入 Settings > Providers
2. 查看当前配置
3. 设置一个无效 API Key（随机字符串）
4. 保存 → 发送消息 → 观察失败
5. 设置正确的 API Key
6. 保存 → 发送消息 → 观察成功

**预期结果**：
- 显示已配置的 providers 列表，每个标注 Configured / No API Key
- API Key 输入框为 type="password"，显示为 `sk-***` 掩码
- 无效 Key 保存后发送消息：显示 401 错误
- 正确 Key 保存后发送消息：正常响应
- 重启应用后 Provider 配置保留
- Console/DevTools 不泄露 API Key 明文

**边界测试**：
- 无 providers 配置：显示空状态 + 引导设置提示
- 保存时网络断开：显示保存失败，不卡住

---

## 4. 失败模式测试（P0）

### 4.1 API 错误

| 场景 | 触发方式 | 预期 |
|------|---------|------|
| 401 Invalid Key | 设置错误 API Key | 显示认证错误，不崩溃 |
| 429 Rate Limit | 短时间发送大量请求 | 显示限流提示，自动重试或提示等待 |
| 500 Server Error | 后端不可用 | 显示服务端错误 |
| 超时（>30s） | 网络慢 | 显示超时提示，不卡在 Running |

### 4.2 流中断

| 场景 | 触发方式 | 预期 |
|------|---------|------|
| SSE 中途断开 | 运行中关闭 WiFi | 已收到 delta 保留，显示连接中断提示 |
| 乱序事件 | 模拟 | 忽略过期事件，显示最新状态 |
| 重复事件 | 模拟 | 去重，不重复显示 |

### 4.3 持久化失败

| 场景 | 触发方式 | 预期 |
|------|---------|------|
| IndexedDB quota exceeded | 存储大量数据 | 显示存储满提示，不崩溃 |
| DB 版本不匹配 | 升级后旧 DB | 自动迁移或提示清理数据 |
| Config 文件损坏 | 手动改写 JSON | 显示配置错误，提供重置选项 |
| 写入失败 | 权限问题 | 显示错误，不丢失已有数据 |

---

## 5. P1 界面功能测试

### 5.1 Sidebar 搜索

**前置**：创建任务 A（"Alpha task"）、B（"Beta task"）、C（"Gamma 任务"）。

**测试步骤**：
1. 搜索框输入 "alpha"
2. 观察过滤 → 只显示 A
3. 清空搜索框 → 显示全部
4. 输入 "任务" → 显示 C
5. 输入 "xyz" → 显示 "No results"

**预期结果**：
- 搜索不区分大小写（"alpha" 匹配 "Alpha"）
- 中文搜索正常工作
- 搜索仅匹配标题，不匹配内容
- 清空搜索恢复完整列表

**边界测试**：
- 特殊字符（`"`, `\`, `/`, `*`）：不崩溃
- 搜索框输入 emoji：正常匹配或显示无结果
- 快速连续输入：不卡顿

### 5.2 Sidebar 重命名

**测试步骤**：
1. 双击 "Alpha task"
2. 输入 "Renamed Alpha"
3. 按 Enter
4. 刷新页面（Cmd+R）

**预期结果**：
- 双击后标题变为输入框，自动选中文字
- Enter 后名称更新到 IndexedDB
- 刷新后名称保持 "Renamed Alpha"

**边界测试**：
- 空名称（清空后 Enter）：恢复原标题 "Alpha task"
- 超长名称（>200 字）：截断显示但存储完整
- Esc 取消：恢复原标题
- Unicode 名称（"测试 🎉 名称"）：正确存储和显示
- 双击空白区域：不触发重命名

### 5.3 Sidebar 删除

**测试步骤**：
1. 鼠标悬停 "Beta task"
2. 点击 X 按钮
3. 确认删除

**预期结果**：
- 任务从列表消失
- IndexedDB 中数据删除
- 删除后跳转到首页或相邻任务
- 搜索中不再出现已删除任务

**边界测试**：
- 删除正在 Running 的任务：先取消任务再删除
- 删除最后一个任务：显示 "No tasks yet"
- 快速连续删除多个：全部正确删除

### 5.4 WelcomePage 最近对话

**前置**：创建 6 个任务。

**测试步骤**：
1. 返回首页
2. 观察最近对话列表

**预期结果**：
- 显示最近 5 条（按 updatedAt 降序）
- 每条显示标题和相对时间
- 点击跳转到对应任务
- 时间格式：just now / Xm ago / Xh ago / YYYY-MM-DD

**边界测试**：
- 无任务：不显示最近对话区域
- 任务无标题：显示 "Untitled"
- 删除一个任务后返回首页：列表更新
- 重命名一个任务后返回首页：标题更新
- failed/canceled 任务：也显示在列表中

---

## 6. P2 辅助功能测试

### 6.1 ChatInput 附件上传

**测试步骤**：
1. 点击 "+" 按钮 → 弹出文件选择器
2. 选择 `package.json` → 显示 chip "package.json"
3. 再点击 "+" → 选择第二个文件 → 显示两个 chip
4. 点击第一个 chip 的 X → 只剩一个
5. 发送消息

**预期结果**：
- 文件选择器弹出
- chip 显示文件名（不含路径）
- 删除 chip 正常工作
- 发送后文件作为 material 传递

**边界测试**：
- 取消文件选择：无 chip
- 选择大文件（>10MB）：能选择，UI 显示大小
- 文件名含中文/emoji：chip 正确显示
- 未发送时切换任务：chip 清空

### 6.2 DesktopSettings 打开/关闭

**测试步骤**：
1. 点击 Settings → 设置面板打开
2. 点击 "< Settings" → 返回主界面
3. 再次打开 → 切换不同 Tab → 每个 Tab 有内容

**预期结果**：
- General: 显示用户信息
- Appearance: 显示 Font Size 和 Density 选项
- Providers: 显示 provider 列表
- Memory: 显示 Enable memory checkbox
- Advanced: 显示 data 路径和 config 路径

### 6.3 Window Lifecycle

**测试步骤**：
1. 最小化（Cmd+M）→ 恢复：界面正常
2. Cmd+Q → 重新打开：数据保留
3. 调整窗口大小到很小（300x400）：布局不错乱
4. 全屏：正常显示

### 6.4 Accessibility（键盘导航）

**测试步骤**：
1. Tab 键：焦点依次移动到 New 按钮 → 搜索框 → 任务项 → ChatInput
2. 在任务项上 Enter：跳转到对话
3. Escape 在设置面板：关闭设置
4. 在 ChatInput 中 Shift+Enter：换行（不发送）

---

## 7. 端到端场景测试

### 7.1 完整对话流程

```
1. 打开应用 → 首页显示
2. 输入 "List files in current directory" → 任务开始
3. 等待工具权限请求 → 点击 Allow
4. 观察进度 → 完成 → 显示 Result
5. 返回首页 → 最近对话显示刚才的任务
6. 从 Sidebar 点击任务 → 恢复对话视图
7. 输入追问 "Show the largest file" → 继续对话
8. 完成 → 检查线程标题已更新
```

### 7.2 多任务切换（单任务模式）

```
1. 开始任务 A → Running
2. 从 Sidebar 点击任务 B（已有历史）
3. 验证：任务 A 自动取消或继续后台运行
4. 在任务 B 中发送新消息 → 正常工作
5. 返回任务 A → 检查状态正确
```

### 7.3 Skill 执行完整流程

```
1. 输入 `/test-fixture hello`
2. Skill 识别 → 执行
3. 输出包含 "FIXTURE_OK"
4. 输入追问 "summarize the result" → 后续对话包含 skill 输出上下文
```

---

## 8. 回归测试清单

每次改动后必须验证（覆盖所有 P0）：

| # | 测试项 | 快速验证 |
|---|--------|---------|
| 1 | 应用启动 | 打开 app → 首屏正常，无 console 错误 |
| 2 | 发送消息 | 输入 "hello" → 有 assistant 响应 |
| 3 | Markdown 渲染 | 响应包含代码块 → 正确渲染 |
| 4 | 任务完成 | 等待 → status = Completed，Result 显示 |
| 5 | 任务取消 | Running 时点 Cancel → status = Idle |
| 6 | 任务失败 | 错误 API Key → status = Failed，错误可读 |
| 7 | 用户问答 | needs_user → 选择 → 继续 |
| 8 | Skill 调用 | /test-fixture → 输出 "FIXTURE_OK" |
| 9 | 工具权限 | 工具请求 → Allow → 继续 |
| 10 | Provider 配置 | Settings > Providers → 设置 Key → 保存成功 |
| 11 | 任务恢复 | 关闭/重开 → 任务状态正确 |
| 12 | Sidebar 列表 | 创建任务 → 显示在 Sidebar |
| 13 | Sidebar 搜索 | 输入关键词 → 过滤正确 |
| 14 | Sidebar 重命名 | 双击改名 → 保持 |
| 15 | Settings 打开/关闭 | 点击 Settings → 进入/返回 |
| 16 | 首页最近对话 | 创建任务 → 首页显示 |
| 17 | 附件上传 | "+" → 选文件 → chip 显示 |

---

## 9. 测试报告模板

```markdown
## 测试执行报告

日期：YYYY-MM-DD
版本：vX.X.X（git SHA: abc1234）
环境：macOS XX.X / arm64 / Node vXX
数据状态：clean / dirty

### 通过项
- [x] 3.1 应用启动：首屏正常，0 errors
- [x] 3.3 发送消息：响应正常，Markdown 渲染正确

### 失败项
- [ ] 3.5 任务取消：Cancel 后 status 卡在 Running
  - 复现步骤：...
  - 截图：...
  - Console 错误：...

### 未测试（需环境配置）
- [ ] 3.6 任务失败：未配置无效 API Key

### 新发现
- 发现：...
- 建议：增加 P1 测试 "..."
```

---

## 10. Codex 评审变更日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v2 | 2026-05-04 | 整合 Codex 对抗性评审 35 项发现：新增 App Startup (3.1)、IPC Bridge (3.2)、Task Failure (3.6)、Offline (3.7)、Tool Permissions (3.10)、Failure Modes (Sec 4)；升级 Providers 到 P0；将所有模糊断言具体化；回归清单从 8 项扩展到 17 项 |
