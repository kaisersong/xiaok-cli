# CLI / Desktop 推理强度策略（2026-10-01）

## 现状与设计

已有模型选择与请求传参实现，但 Desktop 非 legacy 协议仍暴露目录档位，GLM 默认最高档，K3 请求路径未核对 provider type / 合法档位。用户要求避免无用参数和误导，并默认中间强度。

共享策略以 provider type、协议、实际端点和精确 wire model 判断能力；仅已确认支持的官方目录模型及端点启用强度。未知模型、custom、未知代理及不支持的协议不展示、不发送，保留 contextLimit。目录档位按弱到强排列，默认 index floor(length / 2)，偶数取上中位；三档 low/high/max 默认 high，GPT-5 四档默认 medium。合法的已保存选择优先，不覆盖用户选择。

CLI、Desktop 快照与保存、运行绑定、completion payload 都使用同一策略。保存严格拒绝非法值；遗留无效 effort 不显示或发送。Desktop 展示中文及 API 原值、标记 xiaok 默认档，说明强度只在当前模型内比较。模型保存时禁用切换以防并发覆盖。无 IPC schema 或 sibling 资源改动。

## 对抗性自评审

- custom 冒用官方 provider ID 或未知代理不能继承能力；最后请求构造再次校验，不仅依靠 UI。
- 非 legacy 协议目录仍有约束但没有对应传参实现：快照、绑定移除 effort，保存拒绝，窗口元数据保留。
- 仅 UI 默认中档仍会让 GLM 服务端用 max：绑定和 adapter 明确解析并发送中档，捕获生产请求验证。
- 不能把 high 翻译成中：保留高/high，另标默认；不强制转换为通用 medium。
- 合法已保存 max 保留；默认只影响未设置的模型。模型克隆使用目标模型默认和能力。
- 各端独立判断容易漂移：共享策略；renderer 只展示 main 返回的事实。

结论：设计可实现。先写测试再修改 production code。

## 验证

策略、运行绑定、CLI TTY 默认/协议、Desktop 快照/保存/重载、renderer 原值/默认标记/切换、adapter 实际请求默认/非法/省略回归；CLI sandbox 编译及 focused suites，Desktop 类型检查与 main/renderer 构建。请求构造验证不能替代真实厂商 API 验证。

## 本轮结果

- 先运行新增 Desktop 测试，三个断言在旧实现失败：GLM 默认 max、非 legacy 协议仍显示档位、界面缺少 API 值及默认标记。
- 实现后 CLI focused 7 个测试文件 268/268 通过；Desktop main 模型相关 12/12、renderer 模型选择器 4/4 通过。
- CLI production TypeScript 编译、Desktop main/renderer build、Desktop typecheck、任务相关 diff whitespace 检查通过。
- 尚未验证真实厂商 API 的响应差异、实际安装包和安装后的交互界面；未进行发布或安装。

## 旧配置兼容补充（2026-10-01）

验收覆盖 schema v1 和 v2：runtimeOptions 完全缺失、仅 contextLimit、provider 未显式存 baseUrl、非目录/custom 模型及已有合法强度。读取与启动不改写磁盘配置；支持模型在有效配置/请求中补中档，不换 provider/model；未知模型不增加强度。只在用户确认模型或强度时保存，保留原 contextLimit、key、headers、model id、label 和其他配置。

检查发现 Desktop 使用 raw provider.baseUrl 判定 K3 目录和 runtime options，而 CLI 使用 resolveProviderTransport 的官方默认地址；缺失 baseUrl 的旧 K3 配置会在 Desktop 丢目录约束/上下文配置。统一使用实际 transport。runtime options 更新以旧值为底合并 patch，避免新增强度时覆盖原窗口。

对抗性自评审：缺省 URL 只能补官方 profile 默认值，显式自定义 URL 不得改成官方地址；读取不得持久化默认值；更新不得重置已有合法 effort；同一旧配置在 CLI binding 与 Desktop snapshot 必须一致；未知模型保留窗口但不增加请求字段。先用磁盘配置和生产 binding/API 测试复现上述边界，再修正实现。

追加评审：已有模型仅确认/切换时不得重建 provider；否则会把目录同名 custom provider 改成 first_party 或把缺省 baseUrl 写回。只有用户提交 provider 配置字段、provider 缺失或新建模型时执行 ensureProvider。此条件纳入磁盘保留断言。

旧配置兼容结果：21 种旧配置组合复用到 CLI binding、模型选择器、磁盘加载/保存、adapter 请求和 Desktop snapshot/确认/重载测试。覆盖 schema v1/v2、所有当前支持强度的目录模型、不支持的模型/协议、同名 custom provider；原文件在读取后逐字不变。CLI focused 314/314 通过，CLI 交互三条在非受限环境 3/3 通过（sandbox 的进程身份检查阻止 /bin/ps）；Desktop main focused 34/34 通过。Desktop main build 与 typecheck、CLI TypeScript 编译及任务 diff whitespace 检查通过。未运行真实厂商 API、实际安装包交互或发布。
