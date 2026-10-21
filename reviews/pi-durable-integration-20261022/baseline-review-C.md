# 独立席 C：Desktop 最后增量失败基线对照

结论：本席新补跑的 11 个文件、26 个同名失败 case，均在 master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1` 原 source 命令下复现同一首因；额外发现并补跑的 2 个零测试 suite 也在同一 loader 位置复现。没有发现本批新增的未复现 case。此结论不把全量 Desktop 记为通过，不替先前其他对照作超出其证据的归因。

## 选择范围

读取最终 `desktop-full-node24.log`，按指定 `^ ❯ (tests/\S+\.test\.tsx?) \(` 得 43 个失败文件；从 integration 下全部 `*baseline*.json` 的 Desktop cwd/argv 提取既跑文件，其中覆盖 32 个，新增 11 个。对最终 FAIL suite 头另行核对发现指定 regex 漏掉 2 个没有 ❯ 行的零测试套件：workflow-read-port-close-reentry、workflow-read-port-provenance。原日志总表为 **45 failed / 776 passed / 4 skipped 文件；225 failed / 9965 passed / 40 skipped 测试**，不能将 43 当成完整失败文件数。

补跑结束后，以 FAIL suite/case 头得到的全部 45 个失败文件均能在既有和新增 baseline runner argv 联集中找到，无尚未登记的文件。本席逐 case 比较并确认的是下表新增 13 个文件；此前 32 个文件的具体复现结论仍以各自基线证据为准。

## 实际执行与清理

使用既有绝对路径 owned `run.py`，cwd 为 `xiaok-cli-master-baseline/desktop`，Node `v24.16.0`。执行原 source `node node_modules/vitest/vitest.mjs run <files> --maxWorkers=2`。未改源码、断言、内部/外部超时或 NODE_PATH，未用 emitted 测试替代本轮 source 对照。基线 tracked/cached diff 在结束时均为空。

- `desktop-final-baseline.json/log`：11 文件，**26 failed / 135 passed（161）**，exitCode 1，runner PID 38055，测试 PID/PGID 38059，reaped true。
- `desktop-final-suite-baseline.json/log`：额外 2 failed suites、no tests，exitCode 1，runner PID 47447，测试 PID/PGID 47478，reaped true。
- 结束后只读检查上述两个 owned PGID，残留进程为 0。未 adopt/kill 共享 4400 KSwarm，也未对任何共享服务作清理。dynamic workflow 测试使用自身子进程、动态端口与临时 profile，原代码按持有的 child handle 结束自己的服务；本席没有绕过所有权拒绝。

## 同名同错核对

对 11 文件构建 `(测试文件, 完整失败 case 名)` 集合，两边各 26 且完全相同；对应首错误指纹 26/26 相同。进一步检查错误值、实际 source frame 和关键诊断，不因文件字节相同或两边都 exit 1 就推断根因。

| 文件（相对 desktop） | 失败数 | 两边观察到的相同首因/证据 | 分类 |
|---|---:|---|---|
| tests/main/bundled-mcp-v2-contract.test.ts | 1 | bumps bundled plugin versions：kai-report-creator 实际 2.5.1，断言 2.4.0，case 第 63 行 | 基线可复现，版本断言不符 |
| tests/main/e2e-dynamic-workflow-script.test.ts | 1 | 同名 creates dynamic agent nodes…；实际 bridge/broker 链执行后，第 434:81 行数组 deep-equality 断言失败 | 基线可复现，实际集成断言失败；未据此判定整个服务健康 |
| tests/main/inherited-native-readonly.test.ts | 1 | genuine native read grep glob…；期望 evidence.txt 路径，实际返回 The URL must be of scheme file | 基线可复现，source/URL binding；不冒充真实 glob 功能通过 |
| tests/main/kb-integration.test.ts | 13 | 13 个相同完整 case 名均在 requireKbRequestSource 第 6 行 / createCollection 第 155 行报 A valid request source is required to mutate Knowledge | 基线可复现，实际 authority/调用契约拒绝 |
| tests/main/loop-assistant-consumption.test.ts | 4 | actual KB source written…、actual ordinary target save…、ordinary fixed host preserves…、actual ordinary Controller…四项，均为上述 Knowledge request-source 拒绝 | 基线可复现，实际 authority/调用契约拒绝 |
| tests/main/memory-ipc-registry.test.ts | 1 | registers exactly complete16…；要求 18 项，实际 30，case 第 87 行 | 基线可复现，注册数量断言不符 |
| tests/main/react-doctor-low-risk-optimization.test.ts | 1 | clears repeated Intl formatter…；同为 js-hoist-intl 两项，源文件为 ConversationActivityPanel.tsx、collaboration/CollaborationRoomsPage.tsx | 基线可复现，扫描诊断未清；非本批性能收益测量 |
| tests/renderer/capability-migration-snapshot.test.ts | 1 | tracks current legacy flat key count…；实际 321 项、期望 310 项，同样新增 MCP/activity 等 flat keys | 基线可复现，快照预期差异；未更新 snapshot |
| tests/renderer/chat-shell-canvas-session.test.tsx | 1 | does not replay stale running progress…；期望 spy('done')，实际 spy('done','thread-A') | 基线可复现，调用参数断言不符 |
| tests/renderer/desktop-settings-voice-pane.test.tsx | 1 | shows speech model download status…；找不到“语音识别模型” | 基线可复现，渲染断言失败 |
| tests/renderer/workspace-execution-drafts.bdd.test.tsx | 1 | real parent swallowing denied create…；找到多个 alert，分别为模型设置暂不可用与 multi_agent_permission_revoked | 基线可复现，渲染查询/状态冲突 |
| tests/main/workflow-read-port-close-reentry.test.ts | 0（suite） | owned-workflow-network-fixture.mjs:3:65，fileURLToPath 报 The URL must be of scheme file | 基线可复现，source loader/binding；case 没有运行 |
| tests/main/workflow-read-port-provenance.test.ts | 0（suite） | 同上 fixture:3:65，导入发生在测试文件第 6 行 | 基线可复现，source loader/binding；case 没有运行 |

本席新增范围中，没有模块缺失类差异，也没有“candidate 失败、相同 source baseline 通过”的未复现项。URL scheme 错误明确归为源码 loader/binding，不能改称模块缺失或产品行为已验证。

## 原始证据 SHA256

- desktop-full-node24.log：`601cb32e357986f8151382728c4afe6af2fde9aa15eaf2fdbb17c51cf4554d58`。
- desktop-final-baseline.log：`bea8f8244102dfda7faa637bf1a028b89df46e9ff8d1e8b68cb97aca3faf79e6`；runner JSON：`3d775e3982ce7956da44246115f683b77eadd20e925a94055a0a2f75bcd74f74`。
- desktop-final-suite-baseline.log：`6e662f3815a8bf861d678c00ff399be6c3900aa57cd7242b04ec30bfecacc26b`；runner JSON：`5daf04c2fbcdcef325092e20982bb83500c323793d6abd2970dd92c25ecd99ff`。

本对照支持“上述失败在当前 master 同环境 source 路径可复现”，不证明每项真实根因已修复，不抹去 full-suite 红项，也不构成发布资格。
