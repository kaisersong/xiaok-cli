# Xiaok Loop Engineering Release Sentinel

> 只读发布前哨检查。未修改任何源码、测试、配置、lockfile、构建产物；未执行任何 git add/commit/push。除本报告文件本身外，xiaok-cli 工作树唯一变更是本报告。

## Run Metadata

- **Time**: 2026-06-21 06:03 CST（采集开始）/ 06:09 CST（命令收尾）
- **Trigger**: Loop Engineering 发布前哨（user Loop，频率=once，输出本报告）
- **Repository**: `/Users/song/projects/xiaok-cli` @ `master`
- **App Version**: 1.4.9（`/Applications/xiaok.app/Contents/Info.plist` CFBundleShortVersionString = CFBundleVersion = 1.4.9）
- **App Path**: `/Applications/xiaok.app`，`Contents/Resources/app.asar` mtime = 2026-06-19 23:14:25 CST
- **Report Path**: `/Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md`
- **Working Tree**: xiaok-cli 干净（仅本报告文件 1 处 `M`）；kswarm / intent-broker / kai-xiaok-plugins 均干净。

## Executive Summary

1. **可继续 v1.4.9 验证/灰度**。App 可启动（asar 存在）、KSwarm（4400）与 Intent Broker（4318）健康端点均 200 且能力齐全；desktop `typecheck` 与目标 renderer 测试通过。
2. **Loop Engineering 架构在产品中已落地**：Loops/Diagnostics 都挂在 Automations 表面下，General Settings 不再持有 Loop 诊断（已通过代码与测试双重确认，符合 README 宣称）。
3. **主要风险是 i18n 完整性**：`LoopsPane`（`DesktopSettings.tsx`）里约 7 处中文硬编码（删除确认、编辑表单按钮、starter template 文案、toast、最近一次运行失败提示），英文用户会看到中文；这是发版前最值得收口的项。
4. **存在过期设计文档**：`bugfix/2026-06-15-user-loop-disable-schedule.md` 与 `design/2026-06-15-loop-settings-diagnostics-i18n.md` 仍按 "Settings > Loops 内联开关" 描述，而当前实现把调度生命周期迁到 Schedules tab，会让未来贡献者按旧设计实现一遍已被取代的功能。
5. **README 测试声明可被验证**：README 宣称的"88 loop tests"通过逐文件计数核对一致（main/renderer 9 个文件合计 88）。

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | ✅ clean | `git status --short` 仅显示本报告自身 `M quality/loops/loop-engineering-release-sentinel.md` |
| xiaok-cli branch | ✅ master | `git rev-parse --abbrev-ref HEAD` → `master` |
| kswarm git status | ✅ clean | `cd /Users/song/projects/kswarm && git status --short` 空输出 |
| intent-broker git status | ✅ clean | `cd /Users/song/projects/intent-broker && git status --short` 空输出 |
| kai-xiaok-plugins git status | ✅ clean | `cd /Users/song/projects/kai-xiaok-plugins && git status --short` 空输出 |
| App 信息（Info.plist） | ✅ ok | CFBundleShortVersionString=1.4.9, CFBundleVersion=1.4.9 |
| app.asar 完整性 | ✅ ok | `stat -f "%Sm"` → Jun 19 23:14:25 2026；`/Applications/xiaok.app/Contents` 目录存在 |
| Intent Broker health (4318) | ✅ ok | `curl http://127.0.0.1:4318/health` → HTTP 200, `{"ok":true,"status":"healthy","degraded":false}` |
| KSwarm health (4400) | ✅ ok | `curl http://127.0.0.1:4400/health` → HTTP 200, `brokerConnected:true, projects:34, features:["dynamic_workflows","workflow_proposals","workflow_progress_batch","workflow_task_strategy","po_generated_workflow_proposals","workflow_budget_cache_recovery","workflow_script_generated_runs"]` |
| desktop renderer Loop settings test | ✅ pass | `npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic` → 2/2 pass，1.29s（附带运行 `desktop-settings-loops` + `automations-navigation` 共 8/8 pass） |
| desktop typecheck | ✅ pass | `npm run typecheck` → "Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline." |
| Loop 测试声明核对 | ✅ pass | 9 个 loop 相关测试文件 `it/test` 计数总和 = 88，与 README "88 loop tests" 一致 |
| i18n keys 中英覆盖 | ⚠️ 部分 | 见下文「Loop Documentation Review」「Product Behavior Review」「Findings」 |

## Loop Documentation Review

**覆盖情况**

- `README.md`：完整说明 Loop Engineering 模型。第 22 行起有「Loop Engineering in Xiaok」专章；用 7 行表格把 Automation / Connectors / Sub-agents / Memory / Evidence / Diagnostics 与 Xiaok 实现一一映射（第 28–37 行）；明确最小可用 loop（第 41 行）；明确 v1.4.8 起把 Loops/Schedules/Diagnostics 迁到 Automations 表面（第 49、68 行），与当前代码一致。
- `docs/`（symlink → `mydocs/xiaok-cli`）：存在完整的 Loop Engineering 设计/分析/评审链：
  - 愿景边界：`analysis/2026-06-12-loop-engineering-for-xiaok.md`（状态：Accepted；v0 core slice 已在 v1.4.4 落地）
  - 边界与契约：`design/2026-06-12-loop-vs-project-vs-scheduled-task-boundary.md`、`design/2026-06-12-loop-run-record-and-evidence-contract.md`
  - 内置循环：`design/2026-06-14-kswarm-service-health-loop.md`、`design/2026-06-14-loop-diagnostics-notification-policy.md`
  - v1.4.8：`design/2026-06-15-user-loop-template-scheduled-mvp.md`、`design/2026-06-15-desktop-automations-loop-schedule-projects-design.md`、`design/2026-06-15-loop-settings-diagnostics-i18n.md`
  - v1.4.9：`design/2026-06-19-desktop-loop-edit-delete-design.md`、`design/2026-06-15-desktop-loop-generic-task-completion-design-v2.md`
  - 评审闭环：`reviews/2026-06-12-loop-engineering-for-xiaok-adversarial-review.md` 等
- `design/README.md`（Last updated 2026-06-19）：列出了 v1.4.9 改动与 Loop Engineering / Evidence System 阅读顺序；当前 README 只链接 v1.4.5+ 的 loop 文档，旧版（2026-06-15 之前的）已不在导航里。

**用户创建/验证 user Loop 的说明**

- README 第 49 行说明 Loops 入口在 Automations；第 480 行说明 Automations 提供"创建定时任务、绑定循环、查看运行历史、打开循环输出文件"。
- v1.4.8/v1.4.9 设计文档明确：循环模板字段（title / kind / prompt / outputDirectory / outputFileName）、调度绑定、CRUD、立即运行、输出预览。
- 缺一份面向终端用户的"3 步走"操作手册（README 偏架构；docs 偏设计），但已有信息足够用户在 Automations → Loops 创建并验证一个 markdown_file 循环。

**Loop 失败诊断的说明**

- README 第 87 行说明 "Actionable Loop Diagnostics"：anomaly kind、owner、seen count、suggested action、log paths，可复制诊断摘要。
- 代码侧（`renderer/src/components/DesktopSettings.tsx` 的 `LoopsPane sections="diagnostics"`）实现了这些字段，并附 `copy-loop-diagnostics-${loop.id}` aria-label。

**缺口与不一致**

- ❗ **过期设计文档未标 superseded**：
  - `bugfix/2026-06-15-user-loop-disable-schedule.md` 描述"在 Loop 卡片上展示 Enable schedule / Disable schedule / Approve auto-run 三个按钮"，但代码中（renderer 全文检索）没有这些按钮，也没有对应的 locale key（`grep "Enable schedule\|Disable schedule\|Approve auto-run"` 0 命中）。当前模型改为：Loop 卡片只展示调度绑定摘要与"查看计划/+ 为此循环创建定时任务"链接；调度生命周期（暂停/启用/删除）由 Schedules tab 拥有；全局后台自动运行开关在 Automations overview。
  - `design/2026-06-15-loop-settings-diagnostics-i18n.md` 仍以 "Settings > Loops" 命名目标位置；当前产品已迁到 Automations tab。这两份文档未被 v1.4.9 design README 显式标注"已被 v1.4.8 Automations 重构取代"。
- ❗ **README.zh.md 缺失**：`/Users/song/projects/xiaok-cli/README.zh.md` 不存在。中文 Loop Engineering 描述散落在 design/bugfix 文档中，没有面向中文用户的根级 README。任务清单明确要求"判断中英文文档是否一致"，结论是：英文 README 完整、中文根级 README 缺失。

## Product Behavior Review

> 全部为只读检查（grep / read），未修改代码。

**Loop 诊断挂在 Loops 页而非 General 页**

- ✅ `GeneralSettings.tsx`（`renderer/src/components/settings/`）全文检索 `loop|diagnostic` 0 命中。
- ✅ `LoopsPane`（`DesktopSettings.tsx:1907`）只被 `AutomationsPage.tsx`（line 218 sections="user"、line 224 sections="diagnostics"）渲染。
- ✅ `GeneralPane`（`DesktopSettings.tsx:2672`）只在 `activeTab === 'general'` 渲染，并仅通过 `onOpenAutomations` 跳转，不直接持有 Loop 状态。
- ✅ `desktop-settings-loops.test.tsx`（4 个用例）+ `desktop-settings-service-status.test.tsx`（2 个用例）通过。

**Loops UI 文案是否走 locale**

- ✅ 主流可见标签全部走 locale（`t.desktopSettings.newLoop / userLoops / userLoopKindLabel / userLoopOutputDirectoryLabel / loopDiagnosticsRunNow / commonEdit / commonDelete` 等）。
- ❗ **未走 locale 的中文硬编码**（位于 `DesktopSettings.tsx` `LoopsPane` 与周边）：
  1. `handleDeleteLoop`：`confirm('确定要删除这个循环吗？')`（line ~2077）
  2. `handleSaveEdit` 失败 toast：`'保存失败'`（line ~2070）
  3. `handleDeleteLoop` 失败 toast：`'删除失败'`（line ~2085）
  4. `handleCreateFromTemplate` 成功 toast：`` `已从模板创建：${template.title}，记得点编辑修改输出路径里的 ~/ 为完整路径` ``（line ~2164）
  5. `handleCreateFromTemplate` 失败 toast：`'从模板创建失败'`（line ~2168）
  6. starter template 区块：`'从模板快速开始'`、`template.category === 'business' ? '业务' : '代码'`、`'使用此模板'`（line ~2285 / 2296 / 2308）
  7. Loop 卡片：`'+ 为此循环创建定时任务'`（line ~2378）；失败提示：`'最近一次运行{...阻塞/失败}'`（line ~2391）；编辑表单：`'取消' / '保存中...' / '保存'`（line ~2492–2493）
- ❗ **AutomationsPage 也含中文硬编码**：overview 列表 `'查看循环详情 →' / '查看定时任务 →'`（`automations/AutomationsPage.tsx:179`）。
- ❗ **GeneralPane 也含中文硬编码**（虽不属于 Loop，但同源 i18n 漏洞）：`'服务状态'`、`'检查中'`、`'任务并发'`、`'同时执行的最大任务数...'`（`DesktopSettings.tsx:2906–2936`）。

**中文 locale 是否包含任务清单要求词条**

| 任务清单要求 | zh.ts 状态 | 备注 |
| --- | --- | --- |
| 循环 | ✅ `loopsTab: "循环"`（line 1093） | |
| 用户循环 | ✅ `userLoops: "用户循环"`（line 1095） | |
| 新建 Markdown 循环 | ✅ `newMarkdownLoop: "新建 Markdown 循环"`（line 1099） | |
| 新建循环 | ✅ `newLoop: "新建循环"`（line 1100） | |
| 立即运行 | ✅ `loopDiagnosticsRunNow: "立即运行"`（line 1126） | 与内置循环共享同一 key，符合"测试可定位"原则 |
| 启用调度 | ❌ 不存在 | 当前实现不再在 Loop 卡片上提供该按钮（已迁到 Schedules tab + Automations overview 的全局开关 `automationsGlobalAutoRunEnable: "启用后台自动运行"`，line 2012） |
| 关闭调度 | ❌ 不存在 | 同上；最接近的是 `automationsGlobalAutoRunPause: "暂停后台自动运行"`（line 2011） |
| 批准自动运行 | ❌ 不存在 | 当前实现没有"批准单个 Loop 自动运行"的 UI；只有全局后台自动运行总开关 |

**英文 locale 是否包含对应英文词条**

- ✅ `newMarkdownLoop: "New Markdown Loop"`、`loopDiagnosticsRunNow: "Run now"`、`userLoops: "User Loops"`、`automationsGlobalAutoRun*` 全套均存在（en.ts 对应行）。
- ❌ "Enable schedule / Disable schedule / Approve auto-run" 在 en.ts 同样不存在（与中文一致），原因同上。

**重复 Refresh 按钮无障碍名称冲突**

- ✅ 未发现冲突。`LoopsPane` 中的 Refresh 类按钮：
  - 内置循环诊断区有一个全局 refresh 按钮，文案为 `loopDiagnosticsRefresh`（zh "刷新" / en "Refresh"），无显式 aria-label，但页面内仅此一个无后缀的 Refresh，可定位。
  - 每个 Loop 卡片的 "Run now" 用 `aria-label={`run-loop-${id}`}`（含 loopId），用户循环与内置循环命名规则一致但 id 不同，无冲突。
  - 每个 "Copy diagnostics" 用 `aria-label={`copy-loop-diagnostics-${id}`}`，唯一。
  - 用户循环 "Edit / Delete / Preview / Open directory" 均带 loopId 后缀 aria-label。
- ⚠️ 注意点：诊断区全局 refresh 与 `GeneralPane` 的 "Open Automations" 按钮（同样带 RefreshCw 图标）若被误测可造成混淆，但二者文案不同（"刷新" vs "打开 Automations"），不构成命名冲突。

## Adversarial Review

### Maker 视角

- **是否足以让用户理解并执行一个 Loop**：是。`AutomationsPage` 有 Overview / Schedules / Loops / Diagnostics 四个 tab；Loops tab 提供"+ 新建循环"、starter template、编辑、删除、立即运行、输出目录/文件预览；Diagnostics tab 提供内置循环诊断与复制摘要。README 第 49 行解释了为什么 Loops 不在 General Settings。
- **最有价值的信息**：(1) Loop 卡片直接展示调度绑定摘要 + 失败原因 + 输出预览，省去翻 SQLite；(2) Starter templates 把"复制粘贴 prompt + 改路径"压缩到一键；(3) 诊断摘要可复制，对接支持流程顺畅。
- **会阻塞用户的体验**：
  - Starter template 的 toast `"已从模板创建：…，记得点编辑修改输出路径里的 ~/ 为完整路径"`——这是一条埋在 toast 里的关键操作提示。如果用户没看到 toast，新建的循环会因为 `~/` 未展开而失败或写到错误位置。
  - 编辑表单和删除确认弹窗在英文 locale 下会显示中文。
  - 用户如果想为某个循环"暂停调度"，需要在 Schedules tab 找到对应 task 再点 Pause，没有一个 Loop 卡片上的快捷入口（与旧设计文档描述的体验不一致）。

### Checker 视角

- **证据不足的判断**：无。每条结论都附 grep 行号或 curl/test 输出。
- **是否把"构建通过"误当"app 行为通过"**：本次只跑了 typecheck + 2 个 renderer test 文件（+附带的 2 个 loop/automations test）。**实际 app.asar（Jun 19 构建）未被 live 启动**，因此 KSwarm/Intent Broker 的健康握手、Loop run 端到端执行、调度触发链路只在数据层（4400/4318 HTTP 200 + features 数组）间接验证，未做 GUI 烟雾测试。需要在风险分级里把"未做 live app smoke"标注为残余风险。
- **文档写了但产品没实现**：`bugfix/2026-06-15-user-loop-disable-schedule.md` 与 `design/2026-06-15-loop-settings-diagnostics-i18n.md` 描述的"Loop 卡片内联 Enable/Disable schedule + Approve auto-run"按钮在 renderer 全文未命中。属于"文档写过、产品改了路径、文档未更新"。
- **中英文只覆盖一边**：
  - 英文 README 完整，无 README.zh.md（中文根级 README 缺失）。
  - 英文 locale 已覆盖 loops 核心词条；中文 locale 已覆盖；但 `LoopsPane` 内有约 7 处中文硬编码完全绕过 locale，英文用户会看到中文。
- **silent failure 风险**：
  - `handleCreateFromTemplate` 的 `~/` 路径提示只走 toast，未在表单校验阶段拦截；如果 toast 被忽略，循环会以未展开的 `~/` 路径写入，失败原因在 Diagnostics 才能看出。
  - `confirm()` 使用浏览器原生对话框，文案硬编码中文；在某些 Electron 配置下 confirm 行为可能不一致（本次未验证）。

### 冲突与处理顺序

- **冲突**：Maker 认为"调度生命周期迁到 Schedules tab"是合理的简化；Checker 认为"旧设计文档仍存在且未标注 superseded"会误导未来贡献者。
- **处理顺序**：先在文档层给旧设计 doc 加 `> Superseded by v1.4.8 Automations redesign` 头部（低成本、阻断误解）；再决定是否在 Loop 卡片上加一个"在 Schedules tab 管理此循环调度"的快捷链接（已存在 `+ 为此循环创建定时任务` 与 `查看计划`，但缺"暂停/恢复"快捷）。

## Findings

### P0 — None

无 P0。App 可启动、二进制完整、KSwarm/Intent Broker 健康、typecheck 与目标测试通过、未发现 destructive 误触发路径。

### P1

#### P1-1 `LoopsPane` 多处中文硬编码绕过 locale

- **标题**：用户循环删除确认、编辑表单、starter template、toast 文案为中文硬编码。
- **证据**：`renderer/src/components/DesktopSettings.tsx`
  - line ~2077 `confirm('确定要删除这个循环吗？')`
  - line ~2070 `'保存失败'`、line ~2085 `'删除失败'`
  - line ~2164 `` `已从模板创建：${template.title}，记得点编辑修改输出路径里的 ~/ 为完整路径` ``
  - line ~2168 `'从模板创建失败'`
  - line ~2285 `'从模板快速开始'`、line ~2296 `'业务' / '代码'`、line ~2308 `'使用此模板'`
  - line ~2378 `'+ 为此循环创建定时任务'`、line ~2391 `'最近一次运行…阻塞/失败'`
  - line ~2492–2493 `'取消' / '保存中...' / '保存'`
- **影响**：英文 locale 用户在 Loop 创建/编辑/删除/模板/失败提示路径上看到中文；与 README "i18n" 卖点矛盾；自动化测试若按英文断言会失败。
- **建议修复**：新增 `desktopSettings.userLoopDeleteConfirm / userLoopSaveFailed / userLoopDeleteFailed / userLoopCreatedFromTemplate / userLoopCreateFromTemplateFailed / userLoopStarterTitle / userLoopStarterCategoryBusiness / userLoopStarterCategoryCode / userLoopUseTemplate / userLoopCreateSchedule / userLoopLatestRunFailed / userLoopLatestRunBlocked / cancel / saving / save` 等词条到 zh.ts/en.ts，替换硬编码。
- **验证方式**：扩展 `desktop-settings-loops.test.tsx`，新增"在英文 locale 下渲染 Loops tab，断言不出现裸中文字符 / 关键文案为英文"用例。

#### P1-2 旧 Loop 设计文档未标注 superseded

- **标题**：`bugfix/2026-06-15-user-loop-disable-schedule.md` 与 `design/2026-06-15-loop-settings-diagnostics-i18n.md` 描述的 Loop 卡片内联 Enable/Disable/Approve auto-run 控件在当前代码不存在。
- **证据**：`grep -rn "Enable schedule\|Disable schedule\|Approve auto-run\|userLoopScheduleEnable\|userLoopScheduleDisable\|userLoopApproveAutoRun" renderer/src` → 仅命中 `types.ts`，无任何 UI 组件；两份 doc 仍按 "Settings > Loops" 描述目标位置。
- **影响**：未来贡献者按旧设计实现一遍已被取代的 UI；测试可能按旧文案断言；文档与产品出现"文档写了但产品没实现"的 drift。
- **建议修复**：在两份 doc 顶部加 `> Status: Superseded by v1.4.8 Automations redesign（schedule lifecycle moved to Schedules tab + Automations overview global auto-run toggle）`；在 `design/README.md` 的 Loop Engineering 章节加一行索引说明。
- **验证方式**：grep "Superseded" 命中两份 doc；`design/README.md` 出现交叉引用。

### P2

#### P2-1 Starter template `~/` 路径未自动展开

- **标题**：从 starter template 创建循环后，输出路径里的 `~/` 需要用户手动编辑改为完整路径，仅靠 toast 提示。
- **证据**：`DesktopSettings.tsx` line ~2164 的 toast；`userLoopStarterTemplates.ts`（`renderer/src/components/loops/`）的模板定义。
- **影响**：忽略 toast 的用户会得到一个跑不通的循环，diagnostics 才能看出写入失败；新用户首跑体验受损。
- **建议修复**：在 `handleCreateFromTemplate` 提交前对 `~/` 做 `os.homedir()` 展开（renderer 侧通过 IPC 询问 main，或直接在前端用已知 home 目录常量），或在创建表单里展示路径预览。
- **验证方式**：新增测试断言从 template 创建后，`outputDirectory` 不再包含字面量 `~/`。

#### P2-2 `AutomationsPage` overview 含中文硬编码

- **标题**：overview recent failures 列表里的"查看循环详情 → / 查看定时任务 →"为中文硬编码。
- **证据**：`automations/AutomationsPage.tsx:179`。
- **影响**：英文 locale overview 文案混入中文。
- **建议修复**：抽到 `automationsViewLoopDetails / automationsViewScheduleDetails` locale key。
- **验证方式**：在 `automations-navigation.test.tsx` 增加英文 locale 渲染断言。

#### P2-3 `GeneralPane` 服务/并发区块中文硬编码

- **标题**：`GeneralPane`（非 Loop 范围，但同源 i18n 漏洞）的"服务状态 / 检查中 / 任务并发 / 同时执行的最大任务数..."未走 locale。
- **证据**：`DesktopSettings.tsx:2906–2936`。
- **影响**：英文 locale 下 General Settings 出现中文段落，影响整体 i18n 一致性。
- **建议修复**：抽 locale key。
- **验证方式**：扩展 `desktop-settings-service-status.test.tsx` 或新增 GeneralPane i18n 测试。

### P3

#### P3-1 README 缺中文版

- **标题**：`/Users/song/projects/xiaok-cli/README.zh.md` 不存在。
- **证据**：`ls README.zh.md` → No such file。
- **影响**：中文用户没有根级中文 README，需到 design/bugfix 文档里拼装信息。
- **建议修复**：补一份 README.zh.md，至少覆盖 Loop Engineering 章节（可参考 design 文档的中文版）。
- **验证方式**：文件存在且包含 "Loop Engineering" 与 "循环" 关键词。

#### P3-2 Vitest `--reporter=basic` 已弃用

- **标题**：`npm run test -- --reporter=basic` 触发 "DEPRECATED 'basic' reporter is deprecated and will be removed in Vitest v3" 警告。
- **证据**：测试输出顶部的 DEPRECATED 块；建议改用 `reporters: [["default", { summary: false }]]`。
- **影响**：未来 Vitest 升级后命令失效；脚本/CI 需同步调整。
- **建议修复**：迁移 reporter 配置到 `vitest.config` 或脚本里去 `--reporter=basic`。
- **验证方式**：再次运行命令无 DEPRECATED 警告。

#### P3-3 未做 live app smoke

- **标题**：本次只验证了构建产物存在 + 后端端口健康 + 单元/组件测试，未启动实际 Electron app 跑一遍 Loop 端到端。
- **证据**：本报告未含 GUI 启动截图或 Playwright 跑通的日志。
- **影响**：KSwarm/Intent Broker 握手、Loop run 端到端、调度触发链路在 GUI 层的回归未被本次哨检覆盖。
- **建议修复**：发版前补一次 Computer Use / Playwright smoke：启动 app → 进入 Automations → Loops → 创建一个 task_completion loop → 立即运行 → 查看 Diagnostics。
- **验证方式**：smoke 输出截图或日志归档。

## Recommended Next Actions

按优先级排序：

1. **【P1-1】把 `LoopsPane` 与 `AutomationsPage` 内约 9 处中文硬编码抽到 locale**，并新增"英文 locale 下不出现裸中文"的回归测试（最高优先，直接影响英文用户体验与 README 卖点一致性）。
2. **【P1-2】给 `bugfix/2026-06-15-user-loop-disable-schedule.md` 与 `design/2026-06-15-loop-settings-diagnostics-i18n.md` 顶部加 `Superseded` 标注**，并在 `design/README.md` 索引一行说明当前模型（阻断未来贡献者按旧设计实现）。
3. **【P2-1】在 `handleCreateFromTemplate` 提交前展开 `~/` 为绝对路径**，或把 starter template 的默认 `outputDirectory` 改为已展开路径（消除 toast-only 提示的 silent failure 风险）。
4. **【P3-3】补一次 GUI live smoke**（Computer Use 或 Playwright）：创建 task_completion loop → 立即运行 → 查 Diagnostics，归档截图/日志，闭合"构建通过 ≠ app 行为通过"的残余风险。
5. **【P3-1】补 README.zh.md**，至少翻译 Loop Engineering 章节，让中文用户有根级入口。
6. **【P2-3】顺手把 `GeneralPane` 的服务/并发区块抽 locale**（与 P1-1 同源 i18n 修复可合并提交）。
7. **【P3-2】迁移 Vitest reporter 配置**，去掉 `--reporter=basic` 弃用警告，避免下次 Vitest 升级破坏 CI。

## Evidence Appendix

> 仅保留关键命令与精简输出，单条命令不超过约 30 行。

```text
# 1. 时间
$ date "+%Y-%m-%d %H:%M:%S %Z"
2026-06-21 06:03:38 CST

# 2. xiaok-cli git
$ git -C /Users/song/projects/xiaok-cli rev-parse --abbrev-ref HEAD
master
$ git -C /Users/song/projects/xiaok-cli status --short
 M quality/loops/loop-engineering-release-sentinel.md     # 仅本报告

# 3. 关联仓库
$ for r in kswarm intent-broker kai-xiaok-plugins; do git -C /Users/song/projects/$r status --short; done
# (三个仓库均无输出 = clean)

# 4. App 版本与 asar
$ defaults read /Applications/xiaok.app/Contents/Info.plist CFBundleShortVersionString
1.4.9
$ stat -f "%Sm %N" /Applications/xiaok.app/Contents/Resources/app.asar
Jun 19 23:14:25 2026 /Applications/xiaok.app/Contents/Resources/app.asar

# 5. 端口健康
$ curl -s -m 5 http://127.0.0.1:4318/health
{"ok":true,"status":"healthy","degraded":false,"reasons":[],"channels":[],"updatedAt":"2026-06-20T22:03:39.087Z"}
$ curl -s -m 5 http://127.0.0.1:4400/health
{"ok":true,"brokerConnected":true,"projects":34,
 "features":["dynamic_workflows","workflow_proposals","workflow_progress_batch",
 "workflow_task_strategy","po_generated_workflow_proposals","workflow_budget_cache_recovery",
 "workflow_script_generated_runs"]}

# 6. README Loop 覆盖
$ grep -c "[Ll]oop" /Users/song/projects/xiaok-cli/README.md
34
$ ls /Users/song/projects/xiaok-cli/README.zh.md
ls: No such file or directory

# 7. Loop diagnostics 是否在 General Settings
$ grep -n -i "loop\|diagnostic" /Users/song/projects/xiaok-cli/desktop/renderer/src/components/settings/GeneralSettings.tsx
# (无输出 = General Settings 不再持有 Loop 诊断)
$ grep -rn "<LoopsPane" /Users/song/projects/xiaok-cli/desktop/renderer/src
automations/AutomationsPage.tsx:218:  <LoopsPane sections="user" />
automations/AutomationsPage.tsx:224:  <LoopsPane sections="diagnostics" />

# 8. 是否存在 Enable/Disable schedule / Approve auto-run 按钮
$ grep -rn "Enable schedule\|Disable schedule\|Approve auto-run\|userLoopScheduleEnable\|userLoopScheduleDisable\|userLoopApproveAutoRun" \
    /Users/song/projects/xiaok-cli/desktop/renderer/src
# (仅 types.ts 命中类型定义，无 UI 组件)

# 9. 目标测试
$ npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
 ✓ tests/renderer/desktop-settings-service-status.test.tsx (2 tests) 170ms
 Test Files  1 passed (1) | Tests 2 passed (2) | Duration 1.29s

# 10. typecheck
$ npm run typecheck
Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline.

# 11. 附带 loop/automations 测试
$ npm run test -- --run tests/renderer/desktop-settings-loops.test.tsx tests/renderer/automations-navigation.test.tsx --reporter=basic
 ✓ desktop-settings-loops.test.tsx (4 tests)
 ✓ automations-navigation.test.tsx (4 tests)
 Test Files  2 passed (2) | Tests 8 passed (8) | Duration 1.17s

# 12. README "88 loop tests" 核对（逐文件 it/test 计数）
loop-store.test.ts 26 | loop-executor.test.ts 9 | user-loop-template-runner.test.ts 15
kswarm-health-loop.test.ts 7 | artifact-evidence-regression-loop.test.ts 11
kswarm-service-diagnostics.test.ts 10 | automation-overview.test.ts 2
desktop-settings-loops.test.tsx 4 | automations-navigation.test.tsx 4
# 合计 = 88，与 README 声明一致
```

---

**最终确认**：本报告文件已写入 `/Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md`，非空，结构完整（Run Metadata / Executive Summary / Health Checks / Loop Documentation Review / Product Behavior Review / Adversarial Review / Findings / Recommended Next Actions / Evidence Appendix 全部齐备），所有结论均附实际命令与 grep 行号证据。Loop 状态：**成功**。
