# Desktop 聊天底部最终产物筛选

## 问题与边界

`desktop-services.ts` 成功执行 Write 后无条件发出 `artifact_recorded`；ChatShell 将全部记录合并进结果，另从全部 Write 调用收集 generatedFiles。ChatView 直接枚举，导致过程脚本占满底部。

本次只改聊天结果展示投影，不删除事件、磁盘文件，不改变交付判定、KSwarm registry、IPC 或 store。主进程仍是 artifact 事实 owner。关联 KSwarm 的 canonical registry/manifest 已有独立事实，不改其交付语义。

## 展示规则

- 自动观察到的文件（creator=agent、tool:Write/Edit 或 generatedFiles）必须在该轮最终答复/结果摘要中以行内代码、Markdown 链接或完整路径明确引用才展示。不扫描工具过程、用户附件、整段代码示例。
- 已有专业注册（skill、KSwarm、artifact workspace）继续展示；无 creator 的旧文档/媒体记录兼容保留，旧脚本/配置/日志仍须最终引用。
- 引用按完整路径优先匹配，兼容 Windows/UNC/file URL；仅文件名引用只在候选中唯一时接受，不能把同名中间文件一起带入。
- 筛选发生在摘要去重之前；实时底部、历史 result_card 和空卡片判定共用同一投影。执行中不展示新一轮文件卡片。
- 保留原路径去重、点击目标、专业预览/编辑操作。
- 已登记的 A2UI 结果继续保留内嵌预览；混合登记和 fallback 最终文件按路径排重后完整展示。

## 实现前对抗性评审

1. 按扩展名直接屏蔽所有脚本会隐藏真实脚本交付：否决；明确最终引用的脚本允许展示。
2. 仅修 generatedFiles 无法阻止 result.artifacts 旁路：两者一起筛选。
3. 先去重摘要会丢失唯一交付引用：先筛选，再沿用摘要去重。
4. `report.pdf` 子串匹配会命中 `old-report.pdf`，同名文件会混入：解析独立引用、完整路径优先、唯一 basename 回退。
5. 历史回放和直播行为不同，或筛完留下空框：统一用于两条入口和 hasResultCardContent。
6. 把展示筛选写回 snapshot 会丢失取证：只读 renderer 投影，保留来源数据不变。

评审结论：按上述边界实施；这是实施者自审，未冒充独立模型评审。先加真实 ChatView 回归，再改生产代码。验证包含 Windows 截图场景、真实脚本交付、历史/实时、无结果空框、生成失败/执行中、重复摘要、同名路径与点击，以及现有产物预览回归。

## 实际验证

- 新增 ChatView 回归在修复前 11/11 失败；补充路径、混合列表与大小写后为 17/17 通过。
- `cd desktop && npm run test -- --run tests/renderer/chat-view-final-deliverables.test.tsx tests/renderer/chat-view-artifact-edit-action.test.tsx tests/renderer/chat-view-result-dedup.test.tsx tests/renderer/chat-view-a2ui-result.test.tsx tests/renderer/chat-view-failed-state.test.tsx tests/renderer/chat-shell-draft-prompt.test.tsx`：6 suites，63/63 通过。
- `cd desktop && npm run typecheck`：Electron 和 renderer 无新增/现存 diagnostics；`npm run build:renderer` 通过（保留现有大 chunk 提示）。
- `npm run governance:check`：lint、architecture 均 0 新违规；`npm run architecture:check -- --changed`：0 新违规。未更新 baseline。
- Browser 插件不可用，使用已有 Playwright + Chrome，临时入口渲染生产 ChatView 与原 CSS，后端用匿名样例 stub。1100×800 和 744×620 下验证页面身份、内容非空、无框架错误遮罩、无控制台 warn/error、报告/脚本点击与历史切换；9 个候选文件只展示最终交付报告，明确脚本交付保留一项，仅中间文件无空结果框。截图、脚本、日志在仓库外。
- `npm run hygiene:check` 未通过：关联 intent-broker 存在 tracked 改动，kai-xiaok-plugins 存在未跟踪文件；本任务未修改这两个仓库。
- 未验证安装包 main/preload、真实模型输出、Windows 实机；未替换安装版。引用筛选是展示规则，不构成语义验收或交付完成证明。无 creator 的旧文档记录维持兼容展示，因此不承诺旧数据已具备精确的最终/中间角色。
- 测试启动的浏览器、Vite 服务均在 finally 关闭；无任务测试进程残留。
