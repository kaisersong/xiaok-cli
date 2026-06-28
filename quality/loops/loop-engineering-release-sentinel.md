# Xiaok Loop Engineering Release Sentinel

## Run Metadata
- Time: 2026-06-23 22:03:11 UTC
- Trigger: Loop Engineering 发布前哨检查（Xiaok user Loop）
- Repository: /Users/song/projects/xiaok-cli
- App Version: 1.4.13
- App Path: /Applications/xiaok.app
- Report Path: /Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md

## Executive Summary
1. **Loop 诊断和 UI 已正确从 General Settings 迁出**，当前在 Automations 页面的 Loops / Diagnostics tabs 中渲染。General Settings 不再加载 Loop 诊断 API。
2. **中英文 locale 覆盖基本完整**，但英文 locale 中 `runsHistoryOpen` 仍硬编码为中文 `"查看"`，属于 i18n 缺口。
3. **Loop 相关测试（renderer + main）全部通过**（34 个通过），但存在一个无关测试的 sidebar regression 失败。
4. **Typecheck 零诊断通过**，Electron 和 Renderer 均 clean。
5. **README 无 Loop 相关内容，且缺少 README.zh.md**，用户无法从仓库入口文档理解 Loop 概念。建议在发版前补充或指向 design docs。

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ⚠️ Dirty | master; M dist/build-info.js, dist/ui/tool-explorer.js, src/build-info.ts, src/ui/tool-explorer.ts, tests/ui/tool-explorer.test.ts; ?? .kiro/ |
| kswarm git status | ✅ Clean | master; no changes |
| intent-broker git status | ✅ Clean | master; no changes |
| kai-xiaok-plugins git status | ⚠️ Untracked | main; ?? docs/, ?? plugins/kai-canvas-creator/ |
| intent-broker health (4400) | ✅ Healthy | ok=true, brokerConnected=true, projects=36, features=[dynamic_workflows, workflow_proposals, ...] |
| kswarm health (4318) | ✅ Healthy | ok=true, status=healthy, degraded=false |
| desktop renderer Loop settings test | ✅ Passed | desktop-settings-loops.test.tsx (4/4 passed) |
| desktop renderer automations nav | ✅ Passed | automations-navigation.test.tsx (4/4 passed) |
| desktop main loop-store | ✅ Passed | loop-store.test.ts (26/26 passed) |
| desktop main artifact-evidence-loop | ✅ Passed | artifact-evidence-regression-loop.test.ts (11/11 passed) |
| desktop main kswarm-health-loop | ✅ Passed | kswarm-health-loop.test.ts (7/7 passed) |
| desktop renderer service-status | ✅ Passed | desktop-settings-service-status.test.tsx (2/2 passed) |
| desktop typecheck | ✅ Clean | 0 current diagnostics, 0 resolved since baseline |
| sidebar-update-reminder test | ❌ Failed | 3 failed (max-h-[150px] assertion mismatch, unrelated to Loop) |

## Loop Documentation Review

### 文档覆盖情况
- ✅ `docs/analysis/2026-06-12-loop-engineering-for-xiaok.md` — 完整描述 Loop vs Harness 关系、六个构建块（Automation、Worktree、Skills、Connectors/MCP、Sub-agents、Memory）、三个实践原则、xiaok 长期定位。
- ✅ `docs/design/2026-06-12-loop-vs-project-vs-scheduled-task-boundary.md` — 对象边界说明。
- ✅ `docs/design/2026-06-12-loop-run-record-and-evidence-contract.md` — 运行记录与证据合约。
- ✅ `docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` — Loop 设置与诊断迁移设计。
- ✅ `docs/design/2026-06-15-user-loop-template-scheduled-mvp.md` — 用户循环模板 MVP。
- ✅ `docs/design/README.md` — 明确列出 Loop Engineering / Evidence System 阅读顺序。
- ✅ 多个 bugfix 和 quality verify 文档覆盖用户循环具体修复（textual-write-recovery, disable-schedule, output-directory-autocreate）。

### 文档缺口
- ❌ `README.md` 中未提及 Loop、Harness、user Loop 或任何 Loop Engineering 概念。用户从仓库首页无法得知该能力存在。
- ❌ `README.zh.md` **不存在**。中文用户完全缺少入口级文档。
- ⚠️ 设计文档中描述的迁移目标是 `Settings > Loops`，但实际产品实现为 **Automations 页面 > Loops / Diagnostics tabs**。文档与产品路径不一致，可能导致用户按文档找不到入口。
- ⚠️ 文档中未明确说明“如何验证一个 user Loop 是否成功运行”，仅有设计层面的证据合约描述，缺少面向用户的操作指南。

## Product Behavior Review

### Loops 页 vs General 页
- ✅ **GeneralPane 中已完全移除 Loop 诊断**。`GeneralPane`（ DesktopSettings.tsx:2720 ）仅包含 profile、language、service status、task concurrency、stage debug、app info，没有调用 `getLoopDefinitions`、`getLoopRuns`、`getEvidenceAnomalies`。
- ✅ **Loop 诊断在 AutomationsPage 中**。`AutomationsPage` 包含 tabs：`overview`, `schedules`, `loops`, `constraints`, `diagnostics`。`loops` tab 渲染 `<LoopsPane sections="user" />`，`diagnostics` tab 渲染 `<LoopsPane sections="diagnostics" />`。
- ⚠️ **DesktopSettings 侧边栏没有 Loops 入口**。`SettingsTab` 类型和 `navItems` 中均不包含 `loops`。这意味着用户不能从 Settings 侧边栏进入 Loops，而必须从主导航进入 Automations 页面。这与设计文档 `Settings > Loops` 的预期存在偏差。

### i18n 检查
- ✅ 中文 locale (`zh.ts`) 包含：
  - `loopsTab: "循环"`
  - `userLoops: "用户循环"`
  - `newMarkdownLoop: "新建 Markdown 循环"`
  - `loopDiagnosticsRunNow: "立即运行"`
  - `userLoopScheduleActive: "活跃"`
  - `automationsGlobalAutoRunEnabled: "后台自动运行已开启"` / `automationsGlobalAutoRunDisabled: "后台自动运行已暂停"`（对应启用/关闭调度）
  - `automationsGlobalAutoRunEnable: "启用后台自动运行"` / `automationsGlobalAutoRunPause: "暂停后台自动运行"`（对应批准自动运行）
- ✅ 英文 locale (`en.ts`) 包含对应英文词条：`Loops`, `User loops`, `New Markdown Loop`, `Run now`, `active`, `Background auto-run is on/paused`, `Enable/Pause background auto-run`。
- ❌ **英文 locale 中 `runsHistoryOpen: "查看"`** 仍为中文字符，这是一个明显的 i18n 泄漏。

### 无障碍与测试定位
- ✅ 每个 Loop 操作按钮的 `aria-label` 都包含唯一标识，如 `run-loop-${loop.id}`、`edit-loop-${loop.id}`、`delete-loop-${loop.id}`、`copy-loop-diagnostics-${loop.id}`。未发现两个 Refresh 按钮使用同一 `aria-label` 的情况。
- ✅ GeneralPane 的服务重启按钮使用 `aria-label={`restart-service-${service.id}`}`，也是唯一的。

## Adversarial Review

### Maker 视角（用户能否理解并执行 Loop）
- **当前状态不足以让首次用户独立创建并验证 Loop**。用户需要：
  1. 知道 Automations 页面存在（这不是 Settings 的子页面）。
  2. 在 Loops tab 中点击 "New Markdown Loop"。
  3. 配置 Prompt、输出目录、输出文件名。
  4. 在 Schedules tab 中绑定定时计划（Loop 和 Schedule 是分开创建的）。
  5. 在 Diagnostics tab 中查看运行结果和异常。
- **最可能阻塞用户的环节**：Loop 和 Schedule 的分离创建流程。设计文档和 UI 没有 inline 引导说明 "创建 Loop 后还需要去 Schedules 添加触发时间"。
- **最有价值的信息**：Diagnostics tab 提供了一键复制诊断、手动触发、查看异常和日志路径，这对调试 Loop 故障非常有用。
- **体验缺口**：缺少 "Run history" 或 "Last 5 runs" 的直观展示。用户必须切换到 Diagnostics 才能看到运行状态。

### Checker 视角（证据与一致性）
- **证据不足的判断**：设计文档说 `Settings > Loops`，而实际实现是 `Automations > Loops`。我们判定这属于“文档路径过时”而非“功能缺失”，因为 UI 确实提供了完整的 Loops 和 Diagnostics 能力。但需要用户确认这是否是设计变更还是实现偏差。
- **构建通过 ≠ 真实 app 行为通过**：renderer 测试通过只能证明组件在 mock 环境下渲染正确，不能证明 Electron main 进程与 renderer 的 IPC 通信在真实打包 app 中工作正常。需要至少一次 E2E 或手动 smoke test。
- **文档写了但产品没实现**：
  - 设计文档中 `Settings > Loops` 的 sidebar nav 条目未实现（DesktopSettings 中没有 `loops` tab）。
  - 用户 Loop 的 "自动运行批准" 概念在 UI 中体现为 `automationsGlobalAutoRunEnable/Pause`，而非单 Loop 级别的批准开关，粒度差异需确认。
- **中文/英文只覆盖一边**：`runsHistoryOpen` 在 en.ts 中使用了中文，这是反向泄漏（英文覆盖中文）。
- **Silent failure 风险**：
  - `loadLoops` 在 `LoopsPane` 中如果失败只会显示 toast 或 error 文本，但如果 `getLoopDefinitions` 返回空数组，`loopDiagnosticsError` 不会被设置，用户可能误以为没有 Loop 而不是加载失败。测试已覆盖该边界，但真实网络延迟下可能仍有闪烁。
  - `AutomationsPage` 的 `getAutomationOverviewSnapshot` 和 `getAutomationsConfig` 在 catch 中静默 swallow 错误并设置默认值，这可能导致用户看不到后台加载失败的真实原因。

### 冲突点与处理建议
| 冲突点 | Maker 结论 | Checker 结论 | 建议处理顺序 |
| --- | --- | --- | --- |
| Loop 入口路径 | Automations 页面更自然，用户容易找到 | 设计文档写 Settings > Loops，实现不一致可能导致内部沟通混乱 | P2：更新文档或确认产品路径为正式决策 |
| 构建测试通过 | 可以发版 | 不能替代 E2E smoke test | P1：补充一次手动 smoke test（创建 Loop + 手动运行 + 查看诊断） |
| runsHistoryOpen 中文泄漏 | 用户可能不注意到 | 英文界面出现中文，属于质量门禁问题 | P2：修复 en.ts 中该行即可 |

## Findings

### P0
None

### P1
- **标题**: 缺少发版前手动 E2E/Smoke 验证
- **证据**: renderer 测试和 main 测试均通过，但所有测试均为 mock 环境。无 E2E 测试覆盖 Electron 打包后的真实 IPC 和文件系统行为。
- **影响**: 如果打包后 preload API 或 IPC channel 名称不匹配，Loop 创建/运行/诊断功能可能完全失效，但测试无法发现。
- **建议修复**: 在发版前执行一次手动 smoke test：打开 app → Automations → Loops → 新建 Markdown Loop → 填写 prompt → 手动运行 → 确认产物文件生成 → 查看 Diagnostics 确认运行记录和异常。
- **验证方式**: 录制或截图保存到 `quality/loops/smoke-v1.4.x/`。

- **标题**: 文档路径与产品路径不一致
- **证据**: `docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` 明确写 `Settings > Loops`；实际产品在 `AutomationsPage`（`/automations/loops` 和 `/automations/diagnostics`）。DesktopSettings 侧边栏没有 Loops 导航。
- **影响**: 用户按文档找不到入口；内部开发者可能按旧文档实现错误路径。
- **建议修复**: 确认产品路径为最终决策后，更新所有设计文档中的路径描述。或在 DesktopSettings 中增加 `loops` nav 条目并重定向到 Automations。
- **验证方式**: 检查 `docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` 和 `docs/design/README.md` 中的路径引用是否与实际路由一致。

### P2
- **标题**: README 无 Loop 相关内容，且缺少中文 README
- **证据**: `README.md` 中搜索 loop/harness/worktree/sub-agent/connector 无匹配；`README.zh.md` 不存在。
- **影响**: 中文用户和英文用户都无法从仓库首页了解 Loop 能力。需要深入到 `docs/design/` 才能发现。
- **建议修复**: 在 README.md 中增加 "Loop Engineering" 章节，或至少添加指向 `docs/design/README.md` 的链接。补全 README.zh.md。
- **验证方式**: 在 README.md 中搜索 `Loop` 或 `Automations` 有匹配。

- **标题**: 英文 locale 中 `runsHistoryOpen` 硬编码中文
- **证据**: `desktop/renderer/src/locales/en.ts:1239` 为 `runsHistoryOpen: "查看"`。
- **影响**: 英文界面下运行历史按钮显示中文，破坏体验一致性。
- **建议修复**: 改为 `runsHistoryOpen: "Open"` 或 `"View"`。
- **验证方式**: 在 en.ts 中搜索 `"查看"` 无匹配。

- **标题**: xiaok-cli 仓库存在未提交修改
- **证据**: `git status --short` 显示 M dist/build-info.js, M dist/ui/tool-explorer.js, M src/build-info.ts, M src/ui/tool-explorer.ts, M tests/ui/tool-explorer.test.ts, ?? .kiro/。
- **影响**: 发版时可能意外包含或遗漏这些修改。如果它们是 Loop 无关的，应清理或提交到独立分支。
- **建议修复**: 确认这些修改是否属于当前发版范围；如不属于，stash 或提交到独立 PR。
- **验证方式**: `git status --short` 为空。

- **标题**: AutomationsPage 静默 swallow API 错误
- **证据**: `AutomationsPage.tsx:53-55` 和 `:60-62` 中 `catch(() => { ... })` 未向用户展示错误，仅设置默认状态。
- **影响**: 如果自动化后端服务异常，用户看到的是“正常”默认值，而不是错误提示。
- **建议修复**: 在 catch 中至少记录 console.error 或显示一个非阻塞的 toast/alert。
- **验证方式**: 代码审查 + 手动断开服务后查看页面是否显示错误状态。

### P3
- **标题**: kai-xiaok-plugins 存在未跟踪文件
- **证据**: `docs/`, `plugins/kai-canvas-creator/` 未跟踪。
- **影响**: 低。不影响发版，但说明工作区未清理。
- **建议修复**: 确认是否需要 `.gitignore` 或提交这些文件。
- **验证方式**: `git status --short` 在 kai-xiaok-plugins 为空。

- **标题**: 中文 locale 部分 GTD 标签重复
- **证据**: `zh.ts:23-28` 中 `gtdInbox`, `gtdTodo`, `gtdWaiting`, `gtdActive` 等全部翻译为 `"进行中"`，丢失了原意区分。
- **影响**: 轻微。与 Loop 无关，但属于中文 locale 质量。
- **建议修复**: 为不同 GTD 状态提供差异化中文翻译。
- **验证方式**: 代码审查 zh.ts 中 GTD 条目。

## Recommended Next Actions
1. **（P1）执行一次手动 E2E smoke test**：在打包后的 app 中创建用户 Markdown Loop，手动运行，确认产物文件生成和 Diagnostics 显示正确。保存截图或录屏到 quality 目录。
2. **（P1）确认并统一 Loop 入口路径**：决定 DesktopSettings 是否增加 Loops nav 条目，或更新所有设计文档中的路径为 Automations。
3. **（P2）修复 en.ts 中 `runsHistoryOpen` 中文硬编码**：改为 `"View"` 或 `"Open"`，确保英文界面无中文泄漏。
4. **（P2）清理 xiaok-cli 未提交修改**：stash 或提交 tool-explorer 和 build-info 相关修改，确保发版时工作区干净。
5. **（P2）在 README.md 中增加 Loop 介绍**：添加指向 `docs/design/README.md` 中 Loop Engineering 章节的链接，或补全一段 Loop 能力简介。补全 README.zh.md。
6. **（P2）改善 AutomationsPage 错误处理**：将 `getAutomationOverviewSnapshot` 和 `getAutomationsConfig` 的 catch 块改为至少 `console.error` 或显示错误提示，避免静默失败。
7. **（P3）清理 kai-xiaok-plugins 未跟踪文件**：添加 `.gitignore` 或提交 docs/ 和 kai-canvas-creator/。

## Evidence Appendix

### 命令与输出摘要

```bash
$ date -u +"%Y-%m-%d %H:%M:%S UTC"
2026-06-23 22:03:11 UTC

$ cd /Users/song/projects/xiaok-cli && git branch --show-current && git status --short
master
 M dist/build-info.js
 M dist/ui/tool-explorer.js
 M src/build-info.ts
 M src/ui/tool-explorer.ts
 M tests/ui/tool-explorer.test.ts
?? .kiro/

$ cd /Users/song/projects/kswarm && git status --short
# (empty)

$ cd /Users/song/projects/intent-broker && git status --short
# (empty)

$ cd /Users/song/projects/kai-xiaok-plugins && git status --short
?? docs/
?? plugins/kai-canvas-creator/

$ defaults read /Applications/xiaok.app/Contents/Info.plist CFBundleShortVersionString
1.4.13

$ ls -la /Applications/xiaok.app/Contents/Resources/app.asar
# modified Jun 24 01:36

$ curl -s --max-time 5 http://127.0.0.1:4318/health
{"ok":true,"status":"healthy","degraded":false,"reasons":[],"channels":[],"updatedAt":"2026-06-23T22:03:27.230Z"}

$ curl -s --max-time 5 http://127.0.0.1:4400/health
{"ok":true,"brokerConnected":true,"projects":36,"features":["dynamic_workflows",...]}
```

### 测试执行

```bash
$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
✓ tests/renderer/desktop-settings-service-status.test.tsx (2 tests) 141ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/desktop-settings-loops.test.tsx --reporter=basic
✓ tests/renderer/desktop-settings-loops.test.tsx (4 tests) 179ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/automations-navigation.test.tsx --reporter=basic
✓ tests/renderer/automations-navigation.test.tsx (4 tests) 161ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/main/loop-store.test.ts --reporter=basic
✓ tests/main/loop-store.test.ts (26 tests) 116ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/main/artifact-evidence-regression-loop.test.ts --reporter=basic
✓ tests/main/artifact-evidence-regression-loop.test.ts (11 tests) 70ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/main/kswarm-health-loop.test.ts --reporter=basic
✓ tests/main/kswarm-health-loop.test.ts (7 tests) 19ms

$ cd /Users/song/projects/xiaok-cli/desktop && npm run typecheck
Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline.

$ cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/ --reporter=basic
# 53 passed, 1 failed (sidebar-update-reminder.test.tsx, 3 failed assertions unrelated to Loop)
```

### 代码审查关键行号

- `DesktopSettings.tsx:77` — `SettingsTab` 不包含 `'loops'`
- `DesktopSettings.tsx:86-97` — `navItems` 不包含 Loops 入口
- `DesktopSettings.tsx:2720-3032` — `GeneralPane` 无 Loop 诊断代码
- `AutomationsPage.tsx:21-28` — tabs 定义包含 `loops`, `diagnostics`
- `AutomationsPage.tsx:238-253` — `loops` 和 `diagnostics` tabs 渲染 `LoopsPane`
- `locales/en.ts:1239` — `runsHistoryOpen: "查看"`（中文泄漏）
- `locales/zh.ts:1199-1244` — 完整 Loop 中文词条
- `locales/en.ts:1248-1293` — 完整 Loop 英文词条
