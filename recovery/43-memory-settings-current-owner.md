# 历史记忆设置接入当前 owner

本提交在配置迁移 `104091055faa55582300bb5b19d67faad4a73c9a`、模型文件操作 `2b83e61bb054e0d2811866636cf10e2e742008c1` 上合流，保持当前独立的决策模型设置与 r12 自动重排未获资格状态。

Main 服务串行保存配置；既有 LayeredMemoryStore 仍是手动与自动压缩的唯一任务 owner。取消只请求原任务停止，原调用结束前保留 busy；外部 signal 传到原 stateless sidecall 与提交检查。结果继续为 completed/unchanged 与 l1/l2/l3，失败抛出，不恢复旧空成功回执。

恢复模型卡、能力说明、删除确认、手动推理发送范围确认及记忆页键盘导航。确认的模型 ID 经封闭 IPC 传入，仅限制该次手动任务；自动任务仍按当前配置解析。当前用户、窗口与主 frame 授权覆盖新增及旧设置入口。

切换向量模型会等待原实际请求、原 ONNX release 后再清向量和启用新配置。私有集合保留正在使用、切换中及关闭失败的模型，进入切换时同步保留目标。失败后重试必须真正完成原关闭，不以相同配置 ID 当恢复成功。删除拒绝配置中的模型、实际私有库存以及无法确认无关的本地别名；原错误含 undefined，删除恢复失败保留首因与清理错误。

恢复原普通用例时另发现并修复：空模型数组不能消费原始记忆或删去派生结果；L0 关键词与向量检索必须携带自身 scope/cwd，防止项目资料进入其它项目。

## 实际限定验证

- Desktop 14 个整文件：114P，Node24.16；原始 argv 与日志为 `memory-port-final-split-wholes.run.json/.log`。
- 模型文件操作及原 registry 两整文件：22P，`memory-helper-post-union-wholes.run.json/.log`。
- 根 `tsc --noEmit`、`governance:check`、`architecture:check -- --changed` 均退出0；没有更新 baseline/ignore。
- 编码 Codex，真实 xiaok adapter → 官方 api.deepseek.com/deepseek-v4-pro 设计、完整代码及实质修订评审。原 BLOCK、误读、真实 RED 与修复记录全部保留。
- 上述 observer 自然回收，信号0，最后采样后代余0；不把采样称全 OS 后代普查。

原 memory-settings-tabs 的两项验收转入真实 DesktopSettings shell 的独立 memory-settings-tabs 整文件，保留键盘焦点和内容状态断言；旧管理用例的失败注入对准实际私有模型权重 unlink，避免误伤配置锁清理。临时目录按真实路径建立，生产链接拒绝门保留。

## 尚待统一验收

完整聚合提交、最低 Node 原生 ABI、Windows、Main/renderer 构建、真实大模型推理、GUI/协议启动、完整 unsigned Electron 包和最终发布 tgz/安装包尚未由本片验证。此前 Main/preload 两组收集因另片 Core 模块尚未合流而失败，留到完整聚合后执行，不记通过。

这是集成候选，不是 1.6.3 已发布或 Native 已获资格的声明。

原 desktop-settings-systemone 文件加入两项记忆导航验收后实际触发20KB门，按职责拆出独立测试文件，全部原断言保留。没有新增大小例外。
