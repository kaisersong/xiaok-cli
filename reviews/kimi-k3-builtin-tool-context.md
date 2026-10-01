# K3 内置工具描述与严格上下文不兼容

## 根因与设计

真实 1.5.6 ToolRegistry + 注册的 K3 adapter + 真实 PromptBuilder/AgentSessionState，在 buildToolExecutionContext 即抛 KIMI_STRICT_TOOL_CONTEXT_REJECTED。异常栈定位 definition 的 assertExactOwnKeys；遍历生产工具 descriptor 后，唯一 accessor 是 bash.description。严格校验要求自有 data descriptor，且所有工具调用都传完整工具列表，因此任意工具（图片、read、ask_user）都会被 bash getter 阻断。源码与发行版均未解决。

将 bash.description 的平台描述在模块初始化时计算成字符串 data property。实际 Node process.platform 在进程生命周期内不会改变；生产行为与文案保持一致。严格 projector 不放宽 accessor、Proxy、私有字段或自定义 schema 校验。只改变产生描述的内置工具，所有调用路径共用该定义；无须在 K3 或 registry 里特许/执行未知 getter。

## 对抗性评审（测试与实现前）

- 不能通过给 strict projector 添加 getter 特许解决：会执行插件或伪造上下文中的任意 accessor。保留既有拒绝测试。
- 不在 registry 里统一 spread/clone 所有 definitions 来隐式求值 getter：未知定义仍需拒绝。
- 描述是平台常量；Windows/POSIX 文案必须分别验证，测试须在修改平台后重新导入真实模块，不能把生产常量改回 getter 来满足 mock。
- 测试调用完整真实 ToolRegistry 和实际注册的 K3 profile；只注入模型 stream 与无副作用工具，证明首次工具、后续工具结果和可见完成能贯通，并证明 private reasoning 不进入工具上下文。
- 安装只变更 bash.js 描述的匹配文本，保留 1.5.6 新的 compound/observation/terminal 执行代码，不能拿旧 checkout 的整个 bash.js 覆盖发行版。
- Windows 新补丁不覆盖前两版 login、startup native 或 chat exit/ask_user 修复。

## 验证

- 修复前新加的全量 registry 3 个工具流程与 2 个平台描述测试均失败，异常与用户一致；修复后通过。
- `npm run build`、tests TypeScript 编译通过。
- AgentRuntime 75、compact runner 12、全量 registry K3 5 项通过（92）；既有 accessor/Proxy/私有字段等拒绝测试保留。
- npm 1.5.6 发布包选择性应用补丁后 5 项通过，实际 KK 全局安装 5 项通过；Windows/POSIX 平台描述在新 Node 子进程导入时验证（规避 external 模块缓存）。
- bash 真实执行、错误输出、超时 3 项通过；Windows-only 提权输出测试在 macOS 跳过 1 项，不计 Windows 实机证据。
- 只模拟模型 stream 与无副作用 image_generate/read/ask_user handler，没有调用真实图片服务或付费模型。完整原 registry 的 bash 定义参与严格校验。
- 已安装到 KK 的 xiaokcode 1.5.6，仅替换 bash 描述 getter 的两处文本；重复应用显示 alreadyPatched，compound/observation/terminal 执行代码保持。
- 独立 Windows 可用 ZIP `artifacts/xiaok-kimi-tool-context-hotfix.zip` 与 KK Downloads 同摘要副本；用户需退出旧进程再启动。尚未复制到 Kai 或在用户 Windows 上执行。
