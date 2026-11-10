# Kimi 准入失败的临时字段诊断

用户 Ubuntu 1.6.1 多次触发 kimiReasoningAdmissionRetry 后仍终止。现有 adapter 已发送 high effort，并且每次最多两次准入尝试；不能再通过扩大重试或把缺失字段伪造为空串解决。当前本地官方 K3/K3.1 两轮原生 SDK 探针及真实 AgentRuntime 合成工具循环通过，不证明用户历史请求正常。

设计：提供显式 `node --import` 的临时启动器，在当前进程内观察既有 OpenAI SDK Completions 返回的同一个 Stream。原 APIPromise、HTTP Response、SDK stream/controller、每个 chunk、iterator next/return/throw 和原异常保持原样，不提前拉取或复制流。仅过滤官方 Kimi Coding HTTPS endpoint 与固定四个 K3 模型；其它调用完全不处理。

诊断只包含固定模型 ID、序号、布尔、有限枚举及有上限的 frame 计数：官方字段是 string/null/其它，替代字段是否存在，是否存在 content/tool_calls，终止原因类别、response model 类别，和请求 effort/thinking 类别。不得读取/输出 key、headers、原文、工具名称或参数、思考内容、raw error/cause。观察器失败不能改变原请求结果。记录经现有 logger 写到本地 xiaok.log，无额外网络请求；退出进程即移除观察，不改已安装文件或配置。

实施前对抗检查：不在流之外启动 reader/tee；不改变 create 返回的 APIPromise；保持 .withResponse；原 next/return/throw 的 this 与错误身份；准入和重试逻辑不变；字段、模型和错误均不直接序列化；非目标 endpoint/model 不触发；取消和物理流关闭仍归原 SDK。先用真实 SDK + 合成 SSE 验证，再交付给用户。

诊断不是修复或历史根因结论；原 Ubuntu 失败响应的形状仍待复现采集。

验证：`node --test tests/scripts/kimi-wire-diagnostic.test.mjs` 7/7 通过，覆盖真实 SDK 的同一 APIPromise/.withResponse/Response/chunk、字段脱敏、非目标请求、取消/no read ahead、原始异常与 this、诊断 callback 失败隔离、异常元数据隔离，以及不兼容 SDK 的初始化失败不阻止原 CLI。Model recovery 的 Node 22.14.0/24 三平台矩阵已接入此测试，路径过滤同步覆盖。

真实 npm 1.6.1 CLI 入口（仅 HTTP transport 使用合成 SSE）已完成显式 preload 冒烟：官方字段 null + 替代字段 + 未准入正文/工具的响应依旧触发两次准入拒绝及原错误；记录恰好两条固定形状诊断，stdout/stderr 均无合成 key、私有思考或未准入正文 canary。没有执行工具。首次冒烟暴露 SDK 不导出 package.json，现改用公开 resource module 的 exports 入口解析，并重跑通过。

Codex 编写；Kimi K3.1 Pro 通过官方接口独立审查设计、源码和真实 SDK 回归，结论 APPROVE：固定元数据、原 SDK 对象/迭代器语义、过滤和脱敏边界成立。评审只保存最终结论，不保存供应商思考正文。

最终观察器还用于官方真实 K3 + 原 npm 1.6.1 AgentRuntime 合成工具循环：两次 wire 均为 officialString=true，首次工具调用、第二次 stop 正常完成，合成工具只执行一次。这里只能验证观察器对正常请求的透明性，不能证明用户的失败已修复。

最终兼容/异常隔离增量经 Kimi K3.1 Pro 再次审查 APPROVE。语法、7 条 SDK/启动回归、governance 均通过；未构建或替换产品 dist。原用户响应形状仍待采集。
