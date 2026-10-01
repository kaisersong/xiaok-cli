# CLI 正常退出后的 session ownership 恢复

## 证据与设计

2026-10-01，Jev session `sess_e992da74-829f-496b-ba6c-ca8880a34941`
包含 177 条消息、2 次压缩。磁盘 owner 为 `inst_62933_mupegng3_4l50b7`，
PID 62933 已不存在（ESRCH），正常 resume 被拒绝。

当前 checkout 1.5.5 已使用 `intentDelegation: currentIntentLedger`，无需重复修改。
实际全局安装 1.5.6 的 `releaseSessionOwnershipForExit` 已调用 release，并通过
`persistSession({ refreshIntentLedger: false })` 要求保存内存状态，但 persistSession
仍在非 native session 上优先选取磁盘旧 ledger，覆盖了内存中的 released 状态。

修复仅针对已安装的 persistSession：显式禁用 refresh 时使用 currentIntentLedger；
普通保存继续读取最新磁盘 ledger，native/compound ownership transition 保持原实现。
不覆盖全局包为旧 checkout，不改变活跃 owner 拒绝 resume 的机制。

## 对抗性评审

- 普通 session 与恢复的 session 都可能触发：测试连续三次启动/退出，后两次显式 resume。
- /exit 与 EOF 共用释放入口：分别覆盖，退出后从磁盘验证 owner 清空。
- 空 session 不足以检出历史丢失：每次实际完成一个模型回合，后续恢复验证全部旧消息仍在。
- native/compound 的特殊持久化不得被降级到普通 save：原分支与 ownership transition 不改。
- 仍运行的进程不能被清锁：恢复真实数据前检查精确 owner、进程不存在、原文件 hash，
  备份后使用现有 FileSessionStore 与 ownership primitive，验证历史 digest 未变化。
- 安装不得覆盖其他开发功能：只替换一个 JS 文件的一处表达式，检查源 hash、测试报告、
  JS 语法与 patch hash，并保存原文件备份。

## 验收

使用真实 registerChatCommands + TTY harness + FileSessionStore，模型仅替换为 fixture。
原安装版本应失败，checkout 应通过，修复后的 staged 安装应通过。
安装后以独立 CLI 进程在用户 session 副本上执行两次 resume→/exit，验证 177 条消息、
2 次压缩与 historyDigest 均保持，最终真实 session 为 released。

## 实测结果

- TypeScript tests build 通过；原安装版三项退出测试均失败，checkout 三项均通过。
- 修复后的 staged 安装与 checkout 共 18 项回归通过，包括提问输入的六种恢复场景。
- 两次独立 CLI 进程在真实 session 副本上完成 resume→/exit，退出码均为 0，
  ownership 均为 released，177 条消息与 2 次压缩的内容 hash 一致。
- 全局 1.5.6 仅替换 `dist/commands/chat.js` 的一处表达式；版本与其余模块保持原样。
- 真实 session 已由原有 ownership primitive 与 FileSessionStore 释放，历史 digest 保持。
- 安装与会话原文件备份位于 `/private/tmp/xiaok-exit-resume/backup`；测试与验证报告
  位于 `/private/tmp/xiaok-exit-resume`。安装脚本校验源码 hash、测试报告与 owner PID，
  非预期 owner 或仍活跃的原进程会使恢复拒绝执行。
