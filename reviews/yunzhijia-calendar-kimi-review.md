**终票 — 独立 Kimi 评审（编码：Codex GPT-6，不同模型）**
评审范围：仅云之家日历 CLI transport 基础（`yunzhijia-calendar-cli.ts` + 12 单测 + 设计文档），已读 bundle 一次，未执行任何命令。settings/principal/normalizer/durable 未接通，未当作已有。

**逐项核对（对照关注点）**

- **命令注入**：`execFile` + `shell:false` + 固定 argv 枚举（file:22-25）；profile 正则白名单（:45）、event id 首字符禁 `-` 且单参数传值（:101-102）、日期经 safe-integer + `toISOString` 固定格式（:83-85）。无注入面。
- **argv 只读**：`[...args]` 拷贝、类型 `readonly string[]`（:22），二进制限定绝对路径 + basename 白名单（:42-44），不可被调用方换成任意程序。
- **超时/取消**：30s timeout + SIGKILL + AbortSignal 传入子进程（:24-25）；abort 分支先于 killed 判定，误分类路径已堵（:27-29）；read 前后双重 aborted 检查（:56,67）。
- **stderr 泄露**：抛出的全是稳定 code，stderr 原文不进 error.message（:27-31,71-72）；测试38行覆盖。stderr 仍在 `RunResult` 内部返回但未记录、未出 read()，当前无泄露。
- **撤权晚到**：执行前后重验 grant，epoch/accountId 变更即 `yzj_calendar_grant_changed` 丢弃数据（:57,68-70），grant 失效时 after 检查走 catch 同样拒绝。成立。
- **分页误判**：`complete` 仅在 `more===false` 且无 pageToken/total 矛盾时成立；`more` 缺失落 `unknown`（:96-97），空 list 不当作 checked。符合台账"未知不能当成功"。
- **跨平台**：`windowsHide`、`yzj-cli.exe` 分支、无 shell spawn `.cmd`、SIGKILL 由 Node 映射 Windows 终止。无硬编码本机路径。
- **类型**：grant 冻结拷贝、unknown 窄化 + `record()` 校验、envelope success/identity 强校验（:76-77）。typecheck 作者已跑（未要求重跑）。

**结论：APPROVE**（范围内无 P0/P1 阻断）。

跟进项（非阻断，P2 接通前处理）：

1. `RunResult.stderr` 仍对 read() 内部可见；后续 main 组装方必须维持"不进日志/IPC"，建议在类型或封装层固化该约束（file:14）。
2. `count === records.length` 强等值（:90）基于合成回执假设；若真实 CLI 的 count 语义是"总命中数"会误拒合法回执。按台账，假回执不证明真实接口语义，需真实账号/官方 schema 验证后定稿。
3. `error.killed` 一律归 timeout（:29）可能掩盖外部终止，仅影响错误分类精度，不影响安全。
4. 30s/8 天/200 条/1MiB 为硬编码常量（:16-17,83,88），接正式 settings 时收敛为可配置项。

身份声明：本票由独立 Kimi 会话出具，与编码模型 Codex GPT-6 为不同模型，符合 P0/P1 双模型评审要求。
