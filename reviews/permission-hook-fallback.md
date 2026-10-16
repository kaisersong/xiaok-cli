# PermissionRequest 桥接失败回到本地确认

## 证据与设计

实际安装的 CLI 在 PermissionRequest 后、onPrompt 前返回 hook 错误。
Intent Broker 内层默认等待 30 秒，CLI 外层默认 10 秒终止 hook。
用户会话出现连续 hook timeout，read/grep 可用，但需要确认的 bash/write/edit 未执行。

保留外层有界等待。仅 PermissionRequest 的运行异常（包括超时与启动失败）视为
“未取得审批决定”，继续剩余审批 hooks；最后回到原有 onPrompt。本地确认同意前不执行。
任一明确 deny / exit 2 立即拒绝。发生运行异常后，即使其他 hook 返回 allow，也要求本地确认。
其他阻断事件（PreToolUse 等）的失败语义不变；不调整用户权限模式，不重放历史工具。
PermissionRequest 非零退出同样取消已收集的 allow。无需修改 Broker 或全局插件配置，
避免改变其其他客户端行为。10 秒是桥接预算，超时不再代替用户作出拒绝决定。

## 对抗性评审

- 超时不是授权：生产 ToolRegistry + 真实 hook 子进程测试，本地拒绝/同意分别断言零次/一次执行。
- 明确拒绝不可被回退绕过：exit 2、JSON deny、先失败后 deny、先 deny 后 allow 均拒绝。
- 先 allow 后超时不能沿用 allow；先超时后 allow 仍需本地确认，后续 hook 不跳过。
- 用户取消期间 hook 完成后仍由 registry signal 检查阻止打开确认或执行；不修改取消边界。
- PreToolUse 超时仍阻断，安全工具不触发 PermissionRequest；权限策略 deny 不进入本地确认。
- 启动失败/非零退出与超时使用同一审批回退；不通过解析错误字符串推断状态。
- 实际安装只替换 hooks-runner.js，校验旧文件 SHA 并备份；保持版本和其他 WIP 字节不变。
- 当前已打开 CLI 缓存旧模块，不能热替换执行中的 registry；安装后需用户正常退出再恢复同一会话。

## 验证门槛

先新增回归并观察旧实现失败，再修改生产逻辑；运行相关 hooks、tools、permissions 测试、
TypeScript 构建、治理检查。真实独立 tmux TTY 以本地模型和超时 hook 验证拒绝不写入、
同意仅写入一次、下一轮仍可用。定点安装后再以实际安装入口重跑。

## 实测结果

- 旧实现新增回归出现失败，包含超时阻断本地确认、先 allow 后非零退出仍执行、deny 被后续 allow 覆盖。
- 修复后相关 hooks、registry、permissions、permission UI 共 146 项通过。
- release 构建、governance 和 architecture changed 检查通过，无新 baseline。
- 独立 tmux TTY 在构建入口和实际全局安装入口各通过一轮：超时后本地确认、
  拒绝不写入、允许写入、模型收到工具回执、下一轮可用、退出 ownership released。
- 每轮 TTY 回收后，记录的 CLI/hook 进程剩余 0；没有向真实 Broker 发测试审批。
- 全局 CLI 实际 symlink 到主 checkout；定点更新 hooks-runner.js，备份旧模块并比对 SHA。
  同步范围之外的原有 dirty 文件逐一校验未变；当前活跃用户进程未被结束，重启该 CLI 才加载修复。
- 已增加 Session resume CI（macOS/Windows/Linux、Node 22.14/24 与 Linux TTY）；远端结果以本次提交 checks 为准。
