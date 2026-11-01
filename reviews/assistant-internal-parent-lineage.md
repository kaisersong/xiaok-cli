# 内部祖先关联与外部来源分类（实现前）

独立 Kimi 当前 lineage 复审指出：capture 只保存 external parents，内部 tracked parent 的关联被丢弃，之后该祖先 lineage 被原 owner 清除时，子摘要无法沿关联失效。相同 profile 的授权变化已有子 profile fingerprint 保护，但不能代替祖先存在/内容身份检查。

不能直接采纳“所有 parents 一律当外部”的一行修复：现有 hasAssistantExternalLineage 把 parents.length 当外部，普通内部晚报继承会因此禁止 P1 launch/protected producer。设计在 parent ref 增加 main-private 可选 external:boolean；旧记录缺字段继续按 external，保持保守兼容。capture 保存每个有 lineage 的 parent，同时根据其当前 lineage 计算 external。所有 parent 都递归校验存在、hash、可见性；external:false 仅用于路由分类，不跳过任何可见性检查。读时若被标 false 的 parent 实际含外部来源则拒绝，不能借该标志洗掉外部数据。

对抗自审：外部引用、旧缺标志、嵌套外部祖先仍不得启动或写 protected；内部祖先继承保持既有能力；删除/更改/撤权、循环/深度均沿原递归拒绝；客户端/模型无写此字段入口，原同事务 lineage writer 继续拒绝修改已存 run。无新 DB/IPC/table，schema v1 只加兼容可选字段，不承诺旧二进制读取新记录。

先写生产 capture/visibility 的负例与内部兼容正例，再改代码；不同模型复审需覆盖完整 helper、相邻 publication/producer 调用点、真实 writer 与回归。之后重新测试、构建、打包和 GUI，不复用之前的包。
