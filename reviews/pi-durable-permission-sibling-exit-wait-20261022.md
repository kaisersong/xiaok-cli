# Permission TTY兄弟：四个实证退出采样失败（test-only扩展）

本案只设计，不修改源码或运行CPU。前四域405a17c6(TMux)/806dbe43(permission)/60e4d496(11守门)/75bc78e9(workflow)保持冻结；其三席/不同模型票不自动覆盖本案新增四脚本。

## 本轮真实红与静态机制

全部使用root fresh真实dist/index.js e8554df59894526cf65920c92424be1798fd0faa13aea0677a1c81907a055bef，实际Node24.16.0/Python3.13.15、精确node PATH也供hook使用；TMPDIR仅设为现有canonical temp根，未改共享目录权限或放宽生产guard。每run首行EXACT_QUALIFICATION绑定实际脚本/共享helper/entry SHA。

| 原入口 | 真实失败点 | 已到/未到边界 | 原log SHA256 |
|---|---|---|---|
| `text-model-resume.py` | 原126 released断言 | 完整单场景在最后ownership断言失败；旧finally又remaining1，原首因保存在context，不是两个独立业务失败。 | `8e6cd54a856f9733773faf47dffd86ab8af34c3f1e697677e9f876821b35ab01` |
| `resume-history-visibility.py` | 原80 released断言 | 第一次exit_session失败；第二次start/exit未执行，不能称重复resume通过。 | `ab5fa5859b3080d4dc71d2f81497c11cd5cf20d436a925b5b3c4b29e0cea4e2b` |
| `persistent-command-approval.py` | 原67 released断言 | project场景第一次退出失败（先stop后读state）；global及后续resume未执行。 | `777813aaf3b6e0664bae480d410c6ecf9870923866e1a9d7f0a0fb13594d08af` |
| `exact-command-approval.py` | 原59 released断言 | project/redirect第一次退出失败；余下project/python和两global变体未执行。 | `1fbe1e3fa5fff1a0cee9398af015f610d42b5df96567569995cb582ae97455c4` |

五个旧sleep1调用点：text112；history76（exit_session复用）；persistent65和80；exact56（exit_session复用）。这些脚本在发/exit后固定采样，未等待同pane真实exit0；persistent第一次更先kill-session再读state。真实chat先break，再等待完整drain→CAS release→resource close，前次有效本机/CI red已证明notice不等于退出。不能由本轮同族失败反推所有失败只有一个原因，也不能靠最后kill后PID0宣称自然退出。

原第五兄弟yolo-mode.py具有静态相同sleep1，但本轮flag及slash两模式完整PASS，含真实专有bare remote tag变更、恢复和撤销。按最小范围本案不改它、不声称它已有等价真实exit等待，也不因这次绿推所有机器永远满足1秒。新红才另查；本案关闭范围仅四实证red。

所有本轮runner均reaped、原PGID已空；各脚本原owned-pids清单的PID现已不存在。text原remaining1是在原stop之后最终不存在，实际最终code未获证；保留raw/context，不写正常退出。C-permission-qualified-postruns.json逐run记账；fixture根保留forensics，未根据事后stat伪造初始身份或删除。

## 最小补丁（待A/B/root设计票）

仅四文件 tests/e2e/{text-model-resume,resume-history-visibility,persistent-command-approval,exact-command-approval}.py：

1. 所有这五处退出采样替换为已经实审/实测的 `tty.wait_for_exit(timeout=10)`。它只观察同一专有POSIX pane-command真实dead1/明确0/noSignal；remaining deadline/query未知或超时仍fail，不kill促成pass。观察成功后才执行原session/history/compaction/ownership断言和原stop；保留每次退出receipt。新增最大10秒exit观察，明确不同于原sleep1，不改任何产品期限、permission hook500ms、原UI20/30/40、原5秒cleanup预算、原请求/SQL/工具输入或资格。
2. owned mkdtemp根立即resolve，使同一真实home满足既有canonical guard。当前canonical TMPDIR只是本机运行环境，不作为脚本永久正确性替代。不chmod、不强行注册/采纳不同owner、不修改authority/native guard。
3. 各文件局部采用已审TtyCleanupError错误对象策略，避免大重构/改共享helper或前四域：捕获原body异常对象；tty.stop、SSE.close、每PID观察、owned-pids写入、每个诊断print均独立尝试，完整保留原首因及所有cleanup原对象，unknown仍红。text保持原即时PID检查；另三文件保持原5秒PID退出观察，不增加等待、不吞PermissionError。严格remaining非空仍失败，只从finally单一assert迁移为完整错误树的一项。根不rm，unknown journal不强关；成功JSON不能替代runner exit0与无cleanup错误。
4. 不减少或重新定义任何原业务assert、for-loop、source-file只读限制、镜像/图片/compaction人口、grant/命令策略、确认/拒绝、resume次数或原模型请求断言。static AST逐项核业务assert原样；只有严格remaining cleanup assert移入错误聚合。现workflow已调用这四文件，paths均已存在；本案不修改workflow/共享helper/11case或其它源码。

## 验证与停止条件

旧四run已经是实际freshCLI原脚本红，永久保留，不能以本案新预算篡改它们。设计票后才实现；实际diff再三席+新的不同模型只读审，不能借旧四域票。

先做小型实际run清理故障注入验证：在专有诊断副本调用同一真实Python run入口，用准确受信启动叶抛原body E、close/IO各抛原对象，证明每个close均尝试、最终树保E及所有unknown/cleanup；不重实现产品或造成功业务。不使用宽message/子树包含代替完整人口。若无法到达真实cleanup边界则该诊断无效，不凑绿。

然后在root授权唯一slot逐个运行原四完整入口（不是名称filter）：text完整单场景；history完整两次resume；persistent原project/global两scope；exact原project/global×redirect/python四变体，原全部分支和原业务断言均保留。记录每次stop前exit receipt与原ownership，真实freshentry及源SHA、Node/PATH/资格、runnerPID/PGID/exit/reaped、自己的实际PID回收。原Node24先验，最低22.14及真实新HEAD LinuxCI由主笔安排；已绿permission/yolo记录形成原六入口union，不重复相加、也不写同shell六连跑通过。

任何10秒exit超时、非0/signal、release未完成、业务失败或cleanup未知都保红并停止扩大，不自动延时/改assert/提升资格。发生新根因需另案；不改生产、无性能声称或5%收益豁免。现CPU已交A单次trace，本案期间不运行。

## 当前四脚本源绑定

- `tests/e2e/text-model-resume.py` SHA `52160b99a85111840f4e7bb8abe28ce6370672e0435af699ec1f94f960454205`，8851字节；尚未修改。
- `tests/e2e/resume-history-visibility.py` SHA `d16f466d9485fc951eddb895ee959b99aeee9fff046ea29d11ef426dd22ba225`，6900字节；尚未修改。
- `tests/e2e/persistent-command-approval.py` SHA `4d00cf692a2b78bd112a020d21071d9be022d1172beb3c61e15057d9b0ca05fd`，6620字节；尚未修改。
- `tests/e2e/exact-command-approval.py` SHA `98336f55c29d03cf51b38995d5f7c6fa8c78c8a24b6f1f9e23791ca173900d12`，6781字节；尚未修改。
