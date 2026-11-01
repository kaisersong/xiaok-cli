# CLI version 与 statusline

## 当前实现和范围

- `src/build-info.ts` 只有时间，`--version` 只有包版本；没有 `/version`。新增 `/version` 与 `xiaok version [--json]`，二者共享读取当前安装产物的版本信息，不在业务 cwd 执行 git。
- `src/ui/statusbar.ts` 已有字段配置读取与 setFields；复用它，不另起 footer。当前字段只有 model/mode/tokens/session，branch 由隐式规则补入，session 实际显示项目名。
- 参考本地 Codex 的 `codex-rs/tui/src/bottom_pane/status_line_setup.rs`：借用“选择字段并按顺序显示”的模式。此次采用简单命令参数，不移植 picker、主题、配额、外部脚本或其它 Codex 专有字段。
- 对应 terminal architecture §9.10：默认仍显示分支；用户显式自定义时按指定字段显示，可隐藏分支。底栏保持同一 owner、同一行和既有截断策略。

## 设计

1. 构建脚本冻结包版本、完整提交、源码分支、源码提交时间、源码是否有未提交改动、构建时间、构建 Node/platform/arch。未知信息写 null，禁止借用启动目录 git 作为安装版本。保留 BUILD_TIME 兼容欢迎页；normal 使用实际时间，release/rollback 保留可复现策略，时间仅在提供 SOURCE_DATE_EPOCH 时记录，未提供明确显示未记录。生成目录和 build-info/build-flavor 不计入 sourceDirty。
2. `/version` 和独立 version 命令展示冻结构建信息、当前 Node/platform/arch、实际入口和安装根目录；JSON 便于脚本读取。不会打印配置、凭据、用户环境变量或构建机器绝对路径。
3. `/statusline` 显示当前字段、可用字段与用法；`/statusline model,branch,tokens,project,version` 保存顺序并立即应用；支持空格分隔、reset/on、off。字段为 model/mode/branch/tokens/cost/project/cwd/session-id/version；不执行自定义 shell。
4. 自定义偏好单独原子写入本机全局 statusline.json，只包含 schema version 与字段，不读写权限配置。仍兼容原 global/project settings 的 ui.statusBar.fields（session 作为 project 旧别名，旧 tokens 保留费用），新的显式偏好优先；reset 写回默认字段，off 保存空数组。未知字段拒绝且不写入；重复字段去重；损坏偏好回退旧配置。保存失败保留当前状态并显示错误。
5. 文本来自既有 model/cwd/branch/session 状态；渲染前去掉控制字符，避免路径或模型字符串注入多行/ANSI。窗口窄时沿用 scroll-region 的裁剪，不移动光标或新增 footer 行。

## 实现前审查和明确取舍

独立模型 `kimi-for-coding` 已审查设计（GLM-5.3 在 120 秒超时，无有效审查票）。其三个 P1 歧义在实现前明确如下：

- 新偏好只接受 `{version:1, fields:[合法字符串...]}`；fields 必填，缺键/非数组/未知字段/不支持版本均回退旧配置，只有合法 `[]` 关闭字段。
- 不可用字段沿用现有行为省略（无 git 不显示 branch、费用为 0 不显示 cost），不保留空列和多余分隔符。字段顺序指现有值的相对顺序，不是固定宽度列。
- 新 tokens 仅显示上下文使用百分比，cost 单独显示费用。默认顺序 model/mode/branch/tokens/cost/project 保留熟悉的显示组合；旧配置 tokens 仍将费用合为同一渲染片段，旧 session 仍为项目名，branch 沿用旧可见片段位置，避免隐藏 mode 时改变旧排序。

P2 取舍：运行路径是用户要求的本机排查信息，仅运行时展示，测试/源码不携带真实用户路径；配置允许多实例 last-write-wins，不加锁；sourceDirty 明确不包含被构建器重写的生成文件，不作为构建物防篡改证明。`/statusline` 帮助标注新偏好优先旧设置及保存位置，避免旧配置看似无效。不增加启动警告或额外配置步骤。

## 验证与反例

- 元数据必须来自构建，不能在任意新 cwd 变成另一个 repo 的提交；无 git 不崩，release 可复现、SOURCE_DATE_EPOCH 校验、dirty 精确排除生成物。
- 字段只选择指定项并保持顺序；默认费用和旧 session 项目语义保留；空数组必须真的隐藏状态文本，不能被默认值覆盖；活动 spinner 不受隐藏字段影响。
- 保存失败不更新内存，坏字段/坏 JSON 不覆盖现有文件，不触及 settings.json 或其它键。
- focused unit tests + 真实 CLI tmux：/version、状态字段顺序、off/reset、非法输入、退出重启后的持久化和下一轮精确输入；同步本机入口后再验同一脚本。
- 配置改动按仓库规则由 Codex 实现、不同模型审查设计及最终 diff，记录实际模型和结论。

## 审查与本地证据

- 设计由 `kimi-for-coding` 完成澄清后 APPROVE；最终实现由 `deepseek-v4-flash` 审查，结论 APPROVE，无 P0/P1。最终输入 SHA256：`8c539798033c5b3337d4701fb883dba6395c2e7b1cca09cf04c2b3fba5798e37`；生产文件在批准后逐项校验未漂移。
- 旧 StatusBar 新增三个断言先失败：字段顺序、空字段仍泄漏分支、控制字符进入状态行；新实现对应回归通过。首次完整交互发现 `/help` 多两项后标题离开视口；帮助按实际列宽合并短命令，保持全部命令并修正这一回归。
- 旧配置兼容增加三个实际设置 fixture，覆盖无 mode、有 mode、mode 被隐藏时的费用/分支排序。新偏好 schema 缺键、版本不支持、非字符串及非法字段均回退；保存失败、off 跨启动持久化、旧 settings 字节不变均有回归。
- 构建元数据真实 git fixture 通过：固定 SHA、源码 dirty、生成文件排除、rollback 不误报、SOURCE_DATE_EPOCH 可复现、非法时间拒绝、无 git 回退。builtAt 使用带 Z 的 UTC；BUILD_TIME 仅保留欢迎页的本地时间兼容。
- `/version`、`/statusline`、帮助与 statusbar 相关 57 项已通过，governance / architecture 增量均 0 new。真实 tmux 脚本覆盖 80×24 / 48×16、version JSON、字段顺序、非法设置保留、两次重启、off/reset、下一轮输入，两个窗口尺寸均通过。
- Terminal UI CI 增加相关测试、构建元数据测试及 Linux TTY 场景。开工 hygiene 因关联 repo 既有 WIP 未通过，未清理他人文件。Windows / 原生 Ghostty 暂无本机验收；本地同步采用主 checkout 增量构建合并，保持实际命令入口及其它本地修复。
