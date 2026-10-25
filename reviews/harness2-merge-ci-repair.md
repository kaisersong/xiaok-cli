# PR 56 合并与离线检查修复

设计：保留 master 的 typed connectors producer 注册、来源参数、task source population 和 goal shutdown ingress；叠加 Harness 的懒加载 runtime、dispose 与可信窗口 actor，禁止新增授权旁路。preload 采用 master 的非空 connectors DTO，并保留 Harness API。现有 Harness registrar、preload 白名单、renderer 类型及真实 registrar 契约提取保持一致。

测试设计：preload contract 使用既有 main 测试的 Electron mock，只替代宿主边界；生产 registrar 与 preload 工厂照常运行。静态清单使用当前生产调用锚点；用临时源码树分别模拟 LF/CRLF，断言相同行号、原始字节哈希以及缺失/重复锚点拒绝。路径由 Node join/resolve/fileURLToPath 处理，报告路径继续固定 POSIX 标识。

对抗性自审（Codex，非独立模型评审）：不允许用删除 actor 校验或恢复旧 connectors handler 消除冲突；停止接收应在 Harness dispose 等待之前执行。清单不能通过忽略缺失/重复锚点变绿，换行归一化不能改变原始哈希。泛化 catch 会掩盖 Windows 失败，应按阶段输出固定错误码。Windows 原始异常未提供，本轮不能将 CRLF 推断写成已确认根因。未获得第二模型评审，不声称授权代码已通过独立评审。
