# #43 手动本地模型管理 UI：现有决策模型页整合

实际现状：11e0 的 DesktopSettings.tsx:1168–1178 已有 model/decision tab 和 KimDecisionSection；4408–4434 的 MemoryPane 已将 embedding/compaction 独立，并跳转 decision tab。旧 LocalDecisionModels/ModelConfigurationCard/ModelActionDialog 文件均不在当前树。按原功能只补手动管理，保当前 Kim/MemoryPane/两个选择器全部原字节，不复活 memory Jev enabled checkbox、自动 rerank、custom endpoint gateway 或试验诊断。

冻结 Main API：decisionModelsList/Download/Cancel/Remove/Start/Stop/Use + onDecisionModelsChanged；types 与 Main IPC/preload 由 budget 席持有。Start 只发送{modelId,approveCommunityCode:true}，必须在显示来源/revision/codeHash/runtime 后明确确认；dialog 打开后相关信任数据若变更，拒绝原确认并重新选择。Remove 另确认。Use只调用Main保存所选ready模型配置，反馈准确说明自动memory rerank未启用，绝不调用memoryJevConfigure/setEnabled。选中/下载/运行事实均来自Main view，renderer只持局部UI状态，不存localStorage、不启动任何服务/定时poll。

实现：新增DecisionModelSettings（list+一次事件订阅+请求版本/卸载守卫）、LocalDecisionModels（状态/进度/显式按钮与既有Modal）、独立locale字典t.localDecisionModels并同步index/zh/en；在现decision tab Kim下加一个section。bridge只添语义方法，不接任意endpoint/provider。空/错误/不支持平台及未知reason均有本地化反馈，原technical source/revision/runtime数据可查看。nullable runtimeInfo字段按真实冻结类型展示。

并发：订阅先建立再取list；事件递增版本以拒绝慢旧list；卸载取消订阅并使迟到回执失效但不取消Main下载/服务。普通mutation同步ref排他防同tick双击；cancel/stop可中断，分别排他；重载后再次以Main快照为准。动作失败由UI捕获，不产生unhandled；卸载后不setState，不让旧finally清除新动作。模型启动和卸载必须真实用户确认，无mount/effect副作用，locale切换不触发mutations。

顺序：此有限设计对抗审→写实际组件/bridge消费者测试（原无功能红）→生产UI。必要测试一次：订阅比旧list新、卸载/重开迟到数据、按状态支持下载取消/运行停止、重复点击只一动作、启动确认含原来源且变化后旧确认拒绝、Use仅保存不启memory、失败可重试。后与同Main候选合批完整异模审，固定完整SHA统一types/renderer/平台/打包。遵循React技能：action在用户事件内、单订阅、直接import组件、不添加全局轮询或新状态owner。

请评审该有限设计的真实P0/P1，尤其用户确认/事件竞态/生命周期；不用固定输出格式。无所谓Native资格，仅手动管理状态，Main权限和所有NoEscape门保持原严格条件。

设计审原文保留：同步fresh ref在event接收时立即更新，action再读ref，不依赖React state flush；Main固定catalog仍是信任来源，UI仅拒已接收变化，不能声称跨IPC绝对原子。订阅先于list，卸载重开重新取Main状态；旧list成功或错误若过期都无效。interrupted可重新下载；codeHash null明确未提供而非安全认证。Use成功后重取Main列表，不乐观标运行；locale切换只render。实际旧类缺组件初次0collect留档，改runtime变量import后8真实case均缺模块失败，再开始生产UI。

## Actual slice validation

Codex implementation; actual xiaok production adapter -> official DeepSeek `deepseek-v4-pro` independently reviewed the complete staged diff. Review completed naturally, global configuration unchanged. No reachable blocking defect found; original candidate headings withdrawn within the natural output are not treated as confirmed defects. Optional runtime observation display/StrictMode checks remain for aggregate validation; runtime trust confirmation uses the fixed catalog revision, code hash and runtime source/version, while observations are diagnostics. Full raw output retained in task evidence.

`cd desktop && npm run test -- --run tests/renderer/local-decision-model-settings.test.tsx`: 10 passed (1.547s); actual original missing-component regression: 8 failed (1.102s). `npm run governance:check`: exit 0 (2.052s); `npm run architecture:check -- --changed`: exit 0 (1.752s). All observed roots naturally exited; 0 termination signals, 0 sampled descendants remaining. Full typechecks, both desktop builds, minimum Node and whole suites are explicitly deferred until Main/IPC producer and renderer consumer are integrated at the same complete release HEAD.
