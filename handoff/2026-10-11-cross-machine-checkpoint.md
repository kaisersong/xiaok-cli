# 2026-10-11 跨电脑续跑检查点

这是未完成开发的完整源码工作树快照，**不是验收完成、release ready 或主干合并放行**。

## 获取

1. clone `kaisersong/xiaok-cli` 并 checkout `checkpoint/unfinished-handoff-20261011`。不要直接使用 master 代替。
2. 同级 clone `kaisersong/kswarm`、`kaisersong/intent-broker`、`kaisersong/kai-xiaok-plugins`。本次冻结 HEAD 分别为 `16c3ed14c5493a82d000d69d34e4b1c933187433`、`a959b871257c846e68a3896f1cff6fcb2fe82cdf`、`6082d5c2a5502d427b024405a0aa7a7561de0405`；先核实际远端可获取。
3. clone `kaisersong/mydocs` 并 checkout `checkpoint/xiaok-unfinished-handoff-20261011`，阅读 `xiaok-cli/quality/lessons-ledger.md`、原始 `design/2026-10-06-unfinished-development-agent-handoff.md`、`design/2026-10-10-unfinished-development-live-handoff.md` 和本文件。xiaok-cli 的 docs 是 symlink，恢复到该文档目录或替换为新机正确的 symlink。
4. 源码检查点分支的 `handoff/evidence/` 中两份 tar.gz 是历史结果/driver/审查票的精简迁移包。clone 后先校验同名 `.sha256`，再依次解压基础包和 shutdown supplement 到 xiaok-cli repo 根，使 `.artifacts/unfinished-closure-20261001/` 存在。不含 node_modules、完整编译图、原生二进制、安装目录、真实凭证或全部8.7GB缓存；缺少的构建必须在新机重新生成，不能拿摘要假装当前实测。压缩包 manifest 记录选择/省略边界。
5. `npm ci`，再 `cd desktop && npm ci`；按 package engines/node/native依赖要求设置新机。不要运行 npm link 污染全局。开工先 hygiene:check，保留失败与原人口/时限/baseline。

## 源码状态与下一步

- 原完整 IPC 人口298，正式接受203，剩余95；不要把已有typed registration算成完整CODE。原remaining清单 `current-original298-remaining-component-review-20261011-r2.json`：raw86 + Updater3 + Catalog3 + Diagnostics3；ipc79/main16/proxy0。
- **Updater3 独立 CODE 为 BLOCK**：`updater3-ipc-design-20261011-r1/formal-code-independent-component-block-r47.json`。Main getUpdateStatus producer catch（本机 main.ts:1019–1024）把owner projection throw转成全零成功DTO，UI会覆盖lastgood。下一步最小设计明确投影错误传播，真实生产入口先RED，然后窄修复+fresh独审；不要提前增加至206。
- Updater已落source: 单owner启动singleflight/4h timer、source actor gate、完整status snapshot、安装ACK状态机与About/Sidebar读错误处理。三SDK异常message读已走既有toError own-data，真实10/10；旧Sidebar13仅type assertion，完整JS/comment擦除相同。r44真实 Main1768/Renderer2017 strict0，Gov new0，r43真实main/renderbuild均exit0/reaped/gone/sourceDrift0。29记录PID回收；这些是本机历史证据，不是新机当前验证。
- **Catalog3 正式 CODE pending**；单owner2s poll singleflight，busy tick跳过，explicitmanual至多排一次；held>2s与manualqueue真实4/4，Main/characterization/UI14/14。当前r17修cancel ACK `.then(() => loadMcpServers())`，共享r44/r43构建图。最终原族回归/新testlint/独审是否齐全以owner final票为准，不提前209。
- Meeting6、Connectors4、Knowledge10、Scheduled17等完整source component先前已接受；具体原始票在parent queue r25/r27及各目录。源票不替代native/installed/whole-parent。
- Diagnostics3仅完整output/source票，legacy diagnose/trace export input未全qualified，addedToTypedCount0。
- 最新性能生产仅 AppValue SHA49eaed24e3d15c995206c46b47d5b13696ced40acb3d50081d79f44d2080c578、IntentBinding SHAa50a62b1678d8ee9900d60cfe34351dc8830f8ae99ca275c7c896e653d7f8d43 已审入源。原14=12pass2timeout（5022.668ms>5s，30413.415ms>30s）；Loop13全13fail（7.870–8.554s>5s），原始日志仍是失败。不能增时限/减人口/重复挑绿。
- materials firstwrite authority、native R46/R47、latest performance P4 曾被平台自动安全检查中断，只有候选或不完整证据；没有source授权/qualification，**不得换名或改写同任务绕过重试**。保留中断票，其他普通工作可继续。full access不等OS root认证。
- 下一普通可独立组 mobile readonly2（getRelayStatus/getPairingInfo），实际含relayJwt敏感数据，需按正常设计/独审/真实入口/授权边界处理；openRelaySignIn副作用独立。本机只读预查，未开发/未计数。

## 未完成的父验收

保留原176 production consumers、351 broad test files、99真实签名链（原15s RPC/300s roundtrip/3600s test）、14/Loop13时限、84paired、50/100/512MiB、全部Main与新daemon writer/history/principals/migration/restart/retirement/adopt、Windows protectedNTFS与macOS正常安装根、CLI/desktop实际UI/TTY、同版无签名打包/安装/真实运行/下载校验、latest main集成、精确提交与liveCI。原source52/903+2=905局部完整通过并不替代上述父人口。正常workflow191还有2旧builtin fakeinstance失败，保留原case。

## 迁移约束

本分支是恢复检查点，保留未验证实现、候选测试、历史release/dist和原合并进度，不是生产完成commit。原worktree HEAD d54615ba0508b464db85d168e14260af4b289edd，MERGE_HEAD 3d9d1ab36148f74fe953718c5170734b1324c16e，unmerged0；新checkpoint commit保留两个parent。原本机index和HEAD不改，用独立临时index创建tree/commit。主checkout、broker .claude/settings.json、plugins3个人reportHTML以及mydocs其它CLI草稿不纳入。

CPU lease/lock、PIDs、本机路径、manifest安装身份/SSH/原生SDK不迁移成有效事实；新机新epoch重新核对。不要复制旧heavy-cpu-lease.lock或杀同机其他进程。需要重型验证时single owner、记录PID、actual exit/wait/reap/groupGone。只清自己PID；报告数字关联原始日志。

给新机Codex：
> 从 checkpoint/unfinished-handoff-20261011 接手，先读本交接及mydocs台账，保原人口/时限/失败证据/foreign WIP。优先关掉Updater明确BLOCK与Catalog正式CODE，然后继续原298剩余与所有父验收。所有组件通过也不能直接报告全完成。用户要求继续做完，普通操作无需重复确认。

## 关机冻结补充

Catalog最新 `checkpoint-r20.json`：相关6files76项=75PASS/1FAIL/0pending；失败是旧Loop schema扫描断言，新增Catalog3并未完整CODE，PluginsSettings单独type与新test6 lint未验证。r44 fullrenderer图未包含该独立组件，不可借此称本叶全型绿。所有owner已停止开发；Updater29个已记录进程均回收、Catalog自有后台进程0、审查runner0，CPU lease不存在。证据包的历史凭证pattern命中文件被省略，manifest列明；原生安装身份、凭证、node_modules以及完整编译缓存不迁移。

## 解压命令

```sh
cd xiaok-cli
(cd handoff/evidence && shasum -a 256 -c xiaok-unfinished-evidence-20261011.tar.gz.sha256 && shasum -a 256 -c xiaok-unfinished-shutdown-supplement-20261011.tar.gz.sha256)
tar -xzf handoff/evidence/xiaok-unfinished-evidence-20261011.tar.gz
tar -xzf handoff/evidence/xiaok-unfinished-shutdown-supplement-20261011.tar.gz
```

GitHub Release 大包上传超时，已改为直接放入本检查点分支的精简4.6MB历史证据包；不依赖Release下载。其manifest明确只迁移986份小结果/审查票/当前两组记录，旧机8.7GB完整缓存仍保留，缺失的raw日志不能拿摘要补证，应按新机epoch重新验证。


## 2026-10-12 session 恢复后检查点（此节为最新进度）

- 从旧 session `01a1260d-bb6a-7fb0-b46f-4a6f928be784` 的只读恢复记录接续；未修改旧 rollout 或共享 app-server。恢复断点217/298。
- 技能只读2完整源码组件已通过 fresh independent `APPROVE_CODE`：当前219/298，剩79。源码提交 `56547ff2`、文档提交 `697cca6` 均已推送检查点分支。**全部父任务未完成，尚未合并主干。**
- 修复了实际 bridge 仍吞读取错误（页面mock绿未覆盖），外部技能Windows文件名、周统计/详情历史NaN显示和ChatInput初读unknown遗漏。原getter/proxy/serializer/nativePromise/完整metadata与stats10字段、旧错误/正常行为保留；来源观察器只用于Desktop，CLI默认容错保持。
- 当前真实关联97files1105/1105/0pending、CLI12files187/187、完整Main/Renderer strict0、gov/changed/newtestlint12无新增、两build0；自有目录Electron source IPC11成功。探针仅实际CJS/authority/Recorder/typedregistrars及提取真实service+reader/catalog链，**不是正常安装/全部UI/私有native权威票**。补充chmod故障是本机macOS实测，Windows ACL/NTFS与新fixture平台验证继续列在父门，不能外推。
- 两批因果RED（119=111/8与37=36/1）均保留；手动停止的CODE R1因发现初读unknown缺口，exit143/reaped/groupGone/0drift保留，无审批结论。随后修正与新完整CODE R2才接受。原自动中断native/material/P4没有改名或重试。
- 新证据包 `handoff/evidence/xiaok-skills-readonly-recovery-evidence-20261012.tar.gz`、同名sha256及manifest：397份source snapshot/driver/日志/结果/审查/台账与后继预查，约2.5MB；不含依赖、原生凭证、安装目录、live PID/CPU lock或foreign WIP。按sha校验后解压到仓库根。
- 最新父队列 `.artifacts/unfinished-closure-20261001/parent-complete-acceptance-queue-skills-readonly-20261012-recovery-r1.json`；当前组件 final/进度在 `skills-readonly2-20261012-kk-r1/skills-component-final-recovery-r1.json` 与 `recovery-20261012-progress.json`。原176/351清单SHA冻结值保持，全部176/351源文件可用；这不是新父验收通过。
- 下一普通域 Channel/MCP readonly2 已有只读preflight、真实提取当前service方法+真实loadConfig/FileIO的7case characterization与设计草案，**尚未DESIGN批准、没有生产改动、没有加计数**。见 `channel-mcp-readonly2-20261012-recovery-r1/`：坏MCP JSON假空、非数组/坏row直接成功；坏Channel配置被旧loadConfig改为.bak后假空。拟Desktop-only真实只读reader，保Core/CLI原repair行为及mutation7父债；实际runtime App→AppLayout→DesktopSettings两pane，legacy source引用与HTTP API债仍保父范围。
- sibling主checkout与foreign WIP未改；开工hygiene exit1保留（KSwarm/broker各落后1、plugins落后2）。所有原父176/351/99原15s/300s/3600s、14/Loop13/84paired/50-100-512MiB、allwriters/正常安装/Windows/真实UI-TTY/同版unsigned包/CI保持。用户已授权全部完成后合并最新主干测试；普通操作不重复确认，原任务不派子代理。
