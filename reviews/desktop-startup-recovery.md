# Desktop 首帧与历史任务恢复

## 本次根因证据

本轮已安装应用的 main-debug 日志显示 `createWindow:start` 到 `createWindow:loaded` 约 285 秒。生产 `main.ts` 在 loadFile 前 await `services.recoverStaleTasks()`；该入口等待 multi-agent initialization，包括历史 root binding 的串行持久校验。既有 PR #78 已实现同一问题的修复，但未合入当前 master；本次复用其中与启动恢复相关的窄补丁，不引入其 provider、版本或 UI 变更。

## 设计与验证计划（实现前）

1. 保留 artifact workspace 恢复位置；把 generic task recovery 放到 renderer loaded 后，完整异步操作持有既有 bootstrap writer，退出和失败都释放；关闭 gate 后不启动。
   独立审查发现 PR #78 的初始化 writer 空窗：MA initialization 在 services 构造时已经启动，不能等 loaded 才拥有。修订为 services 构造前检查 gate；构造后首个后续 await 前立即以单独标签持有原始 `multiAgent.ready`，即使 load 拒绝或期间退出也继续保留，直到初始化真实结束。
2. 原有 `multiAgentReady`、host recovery、task/Goal/agent 的执行准入继续等待真实恢复。不得用 UI ready 绕过授权或恢复失败。
3. 后台化带来新的并发窗口，连同 PR #78 的 stale running recovery 修复一并复用：同任务 mutation queue 内重新读取；保留两步 expectedPrevious/append-only 持久检查和事件顺序；恢复写入期间同 ID 不能启动。旧 running 读取不得覆盖新 completed。现有 store 并非全快照 CAS，本次不更改其协议。
4. 先移入既有启动/host 竞态回归取得红灯，再应用窄生产补丁。测试真实 window owner、MA service/host、认证 IPC、shutdown gate、partial failure 和 journal receipts。
5. 加入跨平台 CI，构建 root dist 与 Desktop，精确提交涉及的派生产物。安装包复验协作空间加载和冷启动时间，保留后台恢复本身仍可能较慢的边界。

实现前对抗性审查：编码 Codex（GPT-6），独立只读审查 gpt-6-astra。初轮 P1 为上述 writer 空窗，P2 为生命周期时序、执行准入、实际持久冲突缺少回归；均纳入修订设计与测试。修订设计已获可实施结论。最终完整 HEAD 另行复核。未经实测不声称安装包或 CI 已通过。

## 本轮验证结果

- 红灯：旧 host 的 7 条回归中 2 条失败，分别复现 completed 被旧 running 恢复覆盖、恢复保存期间同 ID 可以启动；旧 main 连线测试失败。helper 缺失时的导入错误仅为准备记录，不当行为红灯。
- `npm run test:sandbox:build` 通过；`npm run test:sandbox:run -- .test-dist/tests/runtime/task-host/task-recovery-race.test.js .test-dist/tests/runtime/task-host/task-runtime-host.test.js`：73 passed、7 原有 skipped。其中 race 7 条全部通过，两条额外冲突走真实 store 的 append-only 检查。
- `cd desktop && npm run test -- --run tests/main/desktop-startup-task-recovery.test.ts tests/main/collaboration-room-risk-profile.test.ts tests/main/collaboration-room-ipc-registry.test.ts tests/main/collaboration-room-service.test.ts tests/main/kswarm-project-agent-ipc-registry.test.ts tests/main/kswarm-proxy-ipc-registry.test.ts`：85/85，包括 10 条 startup 与 14 条 risk profile 回归。
- `npm run build:release`、`cd desktop && npm run build && npm run typecheck` 通过。root 构建的无关旧派生产物漂移已清理，提交仅保留本任务 host `.js/.d.ts`。
- `npm run governance:check`、`npm run architecture:check -- --changed`：0 新增违规。
- `CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --dir --config electron-builder.json -c.mac.identity=null -c.win.signAndEditExecutable=false`：通过。原有完整 packaging gate 全部执行，未签名、不发 release。
- 安装前检查 active-task index，使用生产 `recoverTaskSnapshotSync` 核对活跃 journal：无运行任务。旧 main 正常退出残留，备份后仅处理已知空闲旧 PID；不称正常退出通过。
- 两个安装副本 ASAR SHA-256 相同：`10cb575d8fc6826ec47f3c6e7b33fa746dabb6692694c56147fa9917b69a7f7d`。
- 真实安装冷启动 main-debug：start `17:46:55.945Z`、initialization started `17:46:56.335Z`、loaded `17:46:56.717Z`、generic recovery started `17:46:56.718Z`，首帧 **772ms**，先前同环境 **284803ms**。本轮 CUA 实际看见历史列表和输入栏，并成功打开原报错空间详情。
- 原始冷启动摘要与打包日志留在本地 `.artifacts/desktop-startup-20261024/`；不发布用户配置、对话或凭据。后台历史恢复自身仍可能耗时，原执行准入不会因为首帧可见而提前放开。
- 工作树实现经 gpt-6-astra 复核，未发现未关闭 P0–P2。最终完整提交 SHA、远端 CI 另在 PR 记录；此处不预先称已通过。
