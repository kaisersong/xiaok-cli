# Desktop 协作空间详情加载修复

## 证据与设计

安装包的 room service 经真实 broker / KSwarm 只读接口组合后，14 个空间中 6 个在 `projects[0].riskProfile` 报 `expected object, received string`；broker 原始快照均正常。KSwarm `src/core/risk-floor.js` 返回 `low/normal/high` 字符串，Desktop 共享展示 DTO 却只接受对象。

只修正共享项目输出 DTO 的 `riskProfile`：接受字符串，同时保留对象、null、缺省的历史展示兼容性。复用它的协作空间详情、创建项目、项目查询与模式更新同步受益。字段仍然只是展示事实，执行风险判断继续由 KSwarm 持有；无需数据迁移或修改现有项目。

## 实现前对抗性评审（同一 agent 自审）

- 不得删除风险字段或修改用户数据来让页面通过：保留原值，验证真实 service → typed IPC。
- 不得放宽整个项目对象：仅拓展这个字段，保留错误 id、非数据对象、访问器和 Proxy 的既有拒绝行为。
- 不能只测空项目：覆盖真实生产风险推导结果 low/normal/high、带消息的空间、项目创建/模式更新与读取入口。
- 历史对象/null/缺省继续可读；数字、布尔、数组风险值继续拒绝。
- 不改输入、身份、token、授权、执行 gate；新增展示形态不能成为执行授权。
- 源码与安装包验收分开记录，更新前检查运行/排队任务。

## 验证

所有测试使用匿名虚构项目，不复制用户内容或凭据。

- 先跑新增回归：12 条中 6 条按预期失败，3 个字符串档位分别使 room IPC 和 project mutation IPC 拒绝输出。
- 修复后 focused 5 文件共 75 条通过，其中新增文件 14 条（包括 proxy 项目列表/详情读取）。
- `npm run build`、`npm run typecheck` 通过。
- `npm run governance:check`、`npm run architecture:check -- --changed`：0 新增违规。
- 使用构建后的真实 service 和 typed IPC 注册器读取 14 个现有空间：14/14 成功，不持久化用户数据。
- 打包相关 4 文件 54 条通过。首次打包发现隔离 worktree 缺 native artifact export helper 输入，复制已有构建输入后重跑；打包器核对源文件/SDK lock/manifest/二进制并通过，未绕过 gate。
- 无签名本地目录包完成，main 新鲜度、运行依赖 Electron smoke、service contracts、bundled Python runtime gate 均通过。
- 已安装到 `/Applications/xiaok.app` 与用户 Applications，二者 ASAR 与构建包 SHA-256 一致：`999bceb8aebf4c688425810e2ef3c3b6228150030fe9b6ef6630f0171f9719ee`。旧应用备份在用户 `.xiaok/backups/desktop-room-load-20261024/`。
- 实际安装窗口已确认原失败空间及另外两个受影响空间正常显示消息、产物、关联项目；一次返回操作后详情仍正常。其余空间仅有上述 14/14 真实 service/IPC 证据，不称全部窗口逐项验收。
- 本阶段边界：旧进程正常退出后残留且 SIGTERM 未结束，空队列检查及备份后只结束已知旧 main PID。阶段一新进程 17:25:28 启动、17:30:13 页面 loaded；随后用户追加冷启动修复，最终 772ms 首帧及新增初始化生命周期保护见 `reviews/desktop-startup-recovery.md`。旧实例退出残留不是本次修复的验收通过项。
- 开工 hygiene 未通过：主 checkout 和 sibling 有已有未提交内容，broker 分支落后 upstream；本修复在独立 worktree，未改动这些内容，未发布远端。
- 测试后台服务新增存留 0；正式 Desktop 保持运行，临时诊断数据与依赖链接已清理。
