# 独立 eval readonly main profile：窄设计与对抗自审

状态更新：此处保留实施前设计/自审；当前代码与三个小包的独立 Kimi k3 静态评审已完成，见 READONLY-KIMI-REVIEW.md。真实 C 仍受 usage unknown gate 阻塞。

授权：仅独立 eval session 的十个源码副本；default permission 不变，真实默认 runner/foreground/TaskHost，禁止外部 mutation、shell、MCP、技能和 child 控制。Main 构造参数为进程内 branded handle，不出现在 IPC/TaskCreateInput/model。不修改用户配置，质量默认 off。

已有能力核对：ToolRegistry.nativeReadonlyOnly 用 WeakMap native identity 验注册及调用、递归 companion、禁止 deferred/callback/fork 扩权；DesktopOwnedToolRegistry 已支持该规则。未找到 createNativeReadonlyTools，拟用原 createReadTool + host builtin identity/guard inheritance 实现。workflow checkpoint 要读真实外部项目，不能为本 eval 伪造或触发外部请求，故复用其不透明身份/最终 guard 机制而不签假 checkpoint。

方案：mint profile 读取已存在专用 session/manifest，精确十个固定普通 .ts 文件，验证根/父目录无符号链接、inode/content hash，绑定独立 dataRoot/workspace/configDir。只提供原 read 工具的 host wrapper，仍使用 native 身份；每次读同步重验原副本身份及精确路径。profile 构造失败早于任何服务/store 初始化。default runner 入口拒绝非 default、材料、Goal/artifact scopes；预算/取消沿原任务机制。

兄弟路径：
- root/global registry：只含 branded read，动态 register/deferred 由 native registry 拒绝；初始化跳过 project/KB/connectors/read_material 注册。
- catalog scoped read：readonly 档绑定同一精确原工具，不能再 createReadTool(cwd) 扩成整个目录；仍有 current descriptor/authority guard。
- scoped registry：继承 nativeReadonlyOnly，去掉审批 callback（没有需审批工具，也不发 auto grant），permissionManager 仍 default。
- root/child：readonly scope 不安装任何 spawn/send/followup/wait 等控制；无 seed，不能从模型创建 child；已有普通模式不变。不是更宽 child 再靠 prompt 提醒。
- skill/MCP/discovery/material/Room：native 主 registry 拒绝后装工具；原 runner 已跳过 skill/插件/记忆；read_material 额外注册点也跳过。Room/项目工具从未出现在模型 registry，其他 Main-only 用户服务不是模型执行入口。
- 非本 eval、伪造 handle、换根/换文件/插符号链接/模式升级：拒绝；不降级普通 runner。

对抗自审（编码模型自身，不代替后续 Kimi）：
1. safe 不等于 readonly：只接受原 native 身份，不凭 permission/name/描述放行。
2. 当前 catalog 重建 read 是真绕过；必须保留原精确实例，否则不开放付费执行。
3. native registry 禁 onPrompt，直接透传 scope 审批 callback 会启动失败；readonly 不安装该 callback，更不 autogrant。
4. root 控制工具不具 native 身份；明确不安装，保留 group/TaskHost owner；不通过切换 stub runner 逃避真实准入。
5. sha/inode 的路径检查针对模型攻击；不承诺防同 UID 恶意进程在同步 native 文件读之间竞态替换。这档没有写/shell 工具，输入不能制造竞态。
6. 单独来源/模型成本/质量是另外的验收；先真实 checkpoint→真实 morning→原 publication reader→同一 launch service→真实 read/runner/TaskHost，一个案例后再扩。source 不写 isCurrent=()=>true；无法取 current source 就失败。

红测先验证 helper 缺失；随后覆盖伪造 handle、非专用根、scope 文件/兄弟文件/路径穿越/链接/替换、伪 native tool/deferred/companion/skill/MCP、catalog 保留精确 read、native scope 禁 controls、permission 升级拒绝。真实付费执行只能在这些 focused tests 和构建通过后开始。本自审不作为独立批准；后续已完成的 Kimi 原票与 SHA 见 READONLY-KIMI-REVIEW.md。
