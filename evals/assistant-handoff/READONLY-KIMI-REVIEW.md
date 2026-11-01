# Readonly audit 独立 Kimi k3 安全评审

作者：Codex GPT-6。评审：实际 Kimi CLI 2.2.0，明确 `-m kimi-code/k3`。使用默认审批，不加 --yolo/--auto；仅静态阅读 prompt 中的冻结片段，未让评审者执行工具、代码或测试。

结论：三个小包均完整返回 APPROVE，无所审范围内 P0/P1；三个进程退出 0、无 timeout。不是 UX/真实模型 handoff/质量资格/发布批准，也不替代 existing/Goal consumer/picker 的其他评审。默认 pilot gate 没有改变。

原始证据根：`/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/assistant-readonly-kimi-zbo76j9j`。

| 包 | bytes | PID | exitCode / timedOut | 实读正文 |
| --- | ---: | ---: | --- | --- |
| brand-and-files | 9085 | 19535 | 0 / false | APPROVE |
| main-initialization | 8053 | 23446 | 0 / false | APPROVE |
| scoped-siblings | 9506 | 24997 | 0 / false | APPROVE |

每包有 bundle.txt、output.jsonl 原票、process/completion.json、verdict.md。manifest.json 绑定完整源 SHA 和 bundle SHA；source-hash-recheck.json 已核对七文件全部一致，supporting-context-hashes.json 补充被引用的未改 native identity/registry 上下文。总裁决 verdict.json 为作者实读原票后记录，保留 reviewer 的范围限制，不宣称其运行测试。

## 首轮超时不计通过

`assistant-readonly-kimi-q9wtjbkf` 的 scope 大包 16482 bytes，90s 超时、退出 143。只收到 APPROVE 开头的截断正文，末句未完成，明确不计通过。随后缩小为三个 <10KiB 包并将输出限制为简短发现，正常完成；未以等待/超时当授权，也没有换模型、自动放行工具。

## P2 提醒裁决（未改冻结生产代码）

scoped-siblings 原票认为 catalog bind 返回原 read 后，保留引用可能绕过 disposal/revocation。作者实读 `desktop/electron/desktop-multi-agent-capabilities.ts:272`：实际 agent-facing Tool 是 refresh 创建的外层 wrapper；274/277 和 280–285 在 bindInvocation 前再次检查 signal、deadline、authority、descriptor 与 available。原函数不是直接下放给模型。

补充实际生产 registry 负测 `desktop/tests/main/desktop-readonly-audit-retained.test.ts`：保留 scoped read 后分别 dispose 与 revokeWorkspace，再调用均拒绝；合法源读取正向控制通过。该提醒不适用于当前实际 agent-facing handle，不为此修改已冻结生产代码。补充测试第一次仅行号格式断言写错（冒号 vs tab），修正测试后通过；没有改生产来迎合测试。

原票还保留同 UID 外部恶意进程与同步读之间的文件竞态边界；本设计是模型工具边界，不承诺 OS sandbox。源码 helper 实际还做 existing ancestor realpath/lstat 检查，不能将 B 包摘要中的 lexical 说法当成全文实现事实。

## 验证层级

31 项原 focused + 1 项追加 retained 负测已在最新 tests-only 批次同跑通过，原 main build/治理通过；冻结后未重建生产包，只新增测试/评审文档。用户另提供 fresh build exit0 和 403 功能测试绿，未由本席重复运行其整套。

真实 smoke 仍只完成一次 Qwen morning：HTTP200，usage unknown 后退出 2，不再调用。current publication reader 与未确认 draft 已有实际证据，完整 C 仍 0。code APPROVE 不解除 unknown 预算 fence、不填人工标签、不打开默认 pilot。

## 完整源 SHA256

基线 HEAD `4b905b0882b6bb1d5c28dee7c50ce5917d0801a6`；工作树尚未提交，以下文件 hash 才是本次评审准确对象。其他 WIP 不在本席实现范围；desktop-services 的原 formalCreate/assistantThreadTargets 段保留。

| 文件 | SHA256 |
| --- | --- |
| `desktop/electron/desktop-readonly-audit.ts` | `0c9c1d1f3d654aabc2c452b94f127c7509722f2902cfd535e7c824a60cca2862` |
| `desktop/electron/desktop-services.ts` | `160cc3e74ced68c4e66d6097c524d83cf5a16ceb330016cca964d9d2137b3cb0` |
| `desktop/electron/desktop-multi-agent-capabilities.ts` | `a6cd2eb649907b5746c6c42ba1173778da2129918e41e4e7f61daf6a10840d5f` |
| `desktop/electron/desktop-multi-agent-catalog-bridge.ts` | `00e2f122a69f40e0a2ab47ff446efca904ae29557b7156b71c45c852e1476ede` |
| `desktop/electron/desktop-multi-agent-runtime.ts` | `aa37697036d57b27d4ae317219a447502e3cffeffb8913cfd7a6b1a85fe5b560` |
| `desktop/electron/connectors-service.ts` | `66405f19f8e6ce80a5d87d3a47c8e32d9bcd698a0e75d6602754f9b0546cc272` |
| `desktop/tests/main/desktop-readonly-audit.test.ts` | `95f7b2945c4ebd605a668c89204f73fcb5047a130ba0b80ebb783dfeb2c8e822` |
