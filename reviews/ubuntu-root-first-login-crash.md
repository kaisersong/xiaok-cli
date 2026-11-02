# Ubuntu root 首次登录后的会话保存崩溃

## 证据与设计

- 用户的 npm 1.6.1、Node 22.22.1、Linux x64 报告：startupPhase=ready，chat.js:1503 为 chat_finalization_unconfirmed；再次 chat --auto 同样失败。
- 已下载 npm 1.6.1 原包逐行匹配，首次会话保存经过 FileSessionStore.acquireWriterMutationLock → known writer fence.assertOpen → location。
- location 使用 `!uid`，因此真实 UID 0 必定抛 known_writer_fence_user。在原 npm 包将 process.getuid/geteuid 的 OS 观察设为 0 后，直接调用真实 fence.assertOpen 得到相同内部错误；原报告没有内部错误信息，不能仅凭外层堆栈证明没有第二个问题。
- 修复仅把普通写者检查中的 truthy UID 改为非负安全整数检查；继续要求 real UID、effective UID、OS account UID 三者相等，继续执行原目录/owner/mode/symlink/持久 fence 检查。受保护安装和服务的非 root 策略不变。
- 共享检查覆盖 session、goal、task、alias、SQLite 普通 writer。检查同模块没有另一份 truthy UID 判断；受保护安装中的非 root 限制不是同一普通入口，不扩大修改。
- 先以 OS 边界 fixture 跑真实 FileSessionStore 的 K3 首次保存、再次保存、读取与持久 fence 拒写，覆盖 UID 0 和普通用户；拒绝 missing/negative/NaN/fraction/unsafe UID、effective/account mismatch。
- 不能将 macOS 的 OS 边界 fixture 称作 Ubuntu 实机验收；最终需要原 Ubuntu 环境复跑。

## 实施前对抗性评审

GLM-5.3 通过真实 provider adapter 独立审查设计及完整 fence 模块，结论 APPROVE，无 P0/P1。
评审确认只新增接纳合法 UID 0，保留三重 UID 一致、owner/mode 与持久拒写；五类 writer 共享同一 location。
两项 P2 条件：OS fixture 的 uid/euid/userInfo/stat 必须一致，错误断言要区分 user 与 directory；原 Ubuntu 环境复跑前不能排除第二个错误。
编码模型为 Codex，评审模型为 GLM-5.3；评审原文保存在本任务临时证据目录，不包含用户数据或凭证。

## 最终验证

- 新增真实 FileSessionStore 回归 10 项：修复前唯一失败为 UID 0 的首次 K3 保存（known_writer_fence_user），修复后全部通过。普通 UID、非法 UID、effective/account 不一致、目录 owner 不一致及持久 fence 拒写均覆盖。
- 六组既有 session/task/goal/native-goal/alias/SQLite fence 回归共 53 项通过。默认 threads 池中 SQLite 两条因 process.chdir 不支持而失败；用 `--pool forks` 复跑该文件 16/16 通过，未修改用例或 baseline。
- `chat-interactive-runtime.test.js -t 'continues first-run auto chat'`：Kimi/GLM/MiniMax 三条真实登录→隐藏 key→首轮输入→退出流程通过（模型与验证请求使用合成 fixture）。总计 66 个不同回归用例通过。
- `npm run build`、`npm run governance:check`、`npm run architecture:check -- --changed` 通过；生成 dist 与 build-info 未纳入修复。
- npm 1.6.1 原包在 UID 0 OS 观察注入下，真实 CLI/PTY 得到 ready、AggregateError 与 chat.js 1503/351/5088/5184，完整重现用户的四个位置。只应用单文件补丁后同入口进入 K3 输入框、保存会话并可 /exit；不是 Ubuntu 实机运行。
- 临时安装器 `scripts/apply-ubuntu-root-startup-hotfix.mjs`：真实 npm 原文件 SHA-256 门槛、语法检查、原文件备份、单次替换、重复执行与版本/文件不匹配时无写入均通过。仅适用于 npm 1.6.1 原文件。
- GLM-5.3 对最终源码与 10 条回归再次独立审查，APPROVE，无 P0/P1；另审安装器，APPROVE。
- 新回归接入 Terminal UI 的 Node 22.14.0/24 矩阵，Linux/macOS 执行，Windows 因没有 POSIX UID API 明确跳过；push/PR 的 path filter 包含新用例。最终包装后的 10 项复跑通过，GLM-5.3 对 CI 与平台边界增量审查 APPROVE。
- 原 Ubuntu 尚待应用补丁复跑；没有发布新版或宣称用户机器已修复。
