# xiaok Skill 安装与强制触发设计

**日期：** 2026-03-30
**状态：** 草案已确认，待开始实现

---

## 概述

本设计解决 `xiaok` 当前 skill 机制的两个核心问题：

1. skill 安装过程不确定，依赖模型临场决定如何创建目录、复制文件和命名目标路径。
2. skill 触发过程不可靠，系统提示只是在“建议”模型使用 skill，而不是强制协议。

本次改动把 skill 从“本地可选 Markdown 提示片段”升级为更接近 `codex` 的一等能力：

- 提供确定性的 `xiaok skill install <source>` 命令。
- 统一 skill 包格式为目录型 `skills/<name>/SKILL.md`。
- 安装后当前会话热加载，无需重启 `xiaok`。
- 在系统提示和 skill 注入协议中加入强制规则，要求命中 skill 时先加载 skill，再回答或执行。

---

## 目标

- 让用户安装 skill 时不需要反复澄清安装位置、文件名或目录结构。
- 让 `xiaok` 在用户点名 skill 或请求明显匹配 skill 描述时稳定触发 skill。
- 保持与现有平铺 `.md` skill 的向后兼容，不破坏已有 `/plan`、`/review` 等体验。
- 安装后在当前 chat 会话中下一轮输入立即可见，不要求退出重进。

## 非目标

- 本次不做远程 skill marketplace。
- 本次不做 GitHub 下载器或远程 repo 安装。
- 本次不做 skill 开关管理、禁用列表或 UI 菜单。
- 本次不引入 app-server 或文件系统 watch 服务。

---

## 参考基线

这次设计明确参考本地 `codex` 项目的 4 个可靠性机制：

1. skill 是目录包，入口固定为 `SKILL.md`。
2. 安装前先校验 skill 目录和入口文件，失败时拒绝写入半成品。
3. 通过缓存失效与 reload 实现热加载，而不是依赖用户重启。
4. skill 以结构化协议注入模型，而不是仅返回普通文本。

`xiaok` 本次不会完整复制 `codex` 的 app-server、watcher 和多层 config，但会在当前 CLI 架构里实现同等目标的最小方案。

---

## 用户体验

### 1. 安装本地 skill

用户执行：

```bash
xiaok skill install /path/to/my-skill
```

其中 source 支持两种本地输入：

- skill 目录：目录下必须存在 `SKILL.md`
- 单个 Markdown 文件：允许传入 `SKILL.md` 或旧格式 `*.md`

安装成功后输出：

- skill 名称
- 安装目标路径
- 当前会话已可热加载

示例：

```text
已安装 skill: skill-installer
目标路径: /Users/song/.xiaok/skills/skill-installer/SKILL.md
当前会话下一轮输入将自动可见该 skill
```

### 2. 强制触发

以下场景必须先加载 skill：

- 用户显式输入 `/skill-name`
- 用户明确点名某个 skill，例如“用 skill-installer 装一个 skill”
- 用户请求明显匹配某个 skill 描述，例如“帮我安装一个 xiaok skill”

模型在这些场景下不能直接回答“怎么装”，也不能直接执行文件写入；它必须先调用 `skill` 工具读取 skill 内容，再按照 skill 指令行动。

### 3. 热加载

安装命令成功后：

- 新启动的 `xiaok` 会直接加载新 skill
- 已在运行中的交互会话，在下一轮输入前会重新 `reload()` skill catalog，因此无需重启

---

## Skill 包格式

### 推荐格式

安装目标统一为：

```text
~/.xiaok/skills/<skill-name>/SKILL.md
```

目录内后续允许放置附属资源，例如：

```text
~/.xiaok/skills/<skill-name>/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

### 兼容格式

loader 继续兼容现有平铺文件：

```text
~/.xiaok/skills/*.md
./.xiaok/skills/*.md
```

兼容读取只用于历史 skill，不再作为安装命令的输出格式。

### Frontmatter 要求

`SKILL.md` 或旧格式 `.md` 必须包含 YAML frontmatter，且至少包含：

- `name`
- `description`

缺失任一字段时安装失败。

---

## CLI 设计

新增命令组：

```bash
xiaok skill install <source>
```

### 参数语义

- `<source>` 为本地绝对路径或相对路径
- 允许指向：
  - skill 目录
  - `SKILL.md`
  - 旧格式单文件 `.md`

### 安装流程

1. 解析 source 为绝对路径
2. 识别 source 类型
3. 读取并解析 frontmatter
4. 取 `name` 作为目标目录名
5. 写入到 `~/.xiaok/skills/<name>/`
6. 以原子方式完成安装，避免半成品
7. 输出成功信息

### 错误处理

以下情况直接失败，不写目标目录：

- source 不存在
- 目录下无 `SKILL.md`
- 文件 frontmatter 缺失或非法
- `name` / `description` 缺失
- 目标目录已存在
- 拷贝过程失败

---

## 加载与热加载设计

### Loader 行为

当前 loader 只读取某目录下直接存在的 `.md` 文件。本次升级为两条扫描规则并存：

1. 扫描 `skills/*/SKILL.md`
2. 扫描 `skills/*.md`

优先级保持现有覆盖语义：

- builtin
- global
- project

同名 skill 仍按后者覆盖前者。

### Catalog 刷新

`chat.ts` 已经在每轮输入前调用 `reload()`。本次保留这一点，并确保：

- `skill` 命令安装后的文件结构能被下一次 `reload()` 发现
- slash command 列表、`skill` 工具查找、system prompt 中的 skill 列表始终共享同一份 catalog 数据

这意味着我们不额外引入文件 watch，也能满足“安装完后热加载”的要求。

---

## 强制 skill 触发设计

### 现状问题

当前 system prompt 只是把 skill 名称和描述列出来，并写一句“通过 /skill-name 或工具调用方式使用”。这不足以形成强制行为。

### 新规则

在 system prompt 中加入明确协议：

1. 如果用户输入以 `/` 开头并匹配 skill 名称，必须执行该 skill。
2. 如果用户明确提到某个 skill 名称，必须先调用 `skill` 工具加载内容，再继续。
3. 如果用户请求与某个 skill 描述明显匹配，也必须先调用 `skill` 工具。
4. 在满足上述条件但尚未加载 skill 时，不允许直接回答、直接输出计划、或直接执行写入/命令。

### Skill 注入格式

当前 `skill` 工具返回 JSON 字符串。本次保留结构化载荷，但改成更强约束的包裹格式，让模型更容易把它识别成“当前必须遵守的指令片段”，而不是普通参考文本。

载荷至少包含：

- `name`
- `path`
- `source`
- `tier`
- `content`

并带一个明确语义：这是当前任务必须遵守的 skill 指令。

---

## 实现边界

### 新增模块

- `src/commands/skill.ts`
  - 注册 `xiaok skill install`
- `src/ai/skills/install.ts`
  - source 识别、frontmatter 校验、目标路径计算、原子安装

### 修改模块

- `src/index.ts`
  - 注册 skill 命令
- `src/ai/skills/loader.ts`
  - 同时支持目录型 `SKILL.md` 与平铺 `.md`
- `src/ai/skills/tool.ts`
  - 输出更强约束的结构化 skill payload
- `src/ai/context/yzj-context.ts`
  - 注入强制 skill 触发规则
- `src/commands/chat.ts`
  - 继续统一使用单一 skill catalog，确保热加载路径稳定

### 测试模块

- `tests/ai/skills/loader.test.ts`
- `tests/ai/skills/tool.test.ts`
- `tests/ai/context/yzj-context.test.ts`
- `tests/commands/skill.test.ts`（新增）
- `tests/ai/skills/install.test.ts`（新增）

---

## 测试策略

实现遵循 TDD，先写失败测试，再写最小实现。

### 需要覆盖的行为

1. 本地目录型 skill 可被安装到标准目标路径
2. 本地单文件 skill 可被转换安装为 `SKILL.md`
3. 缺少 `SKILL.md`、缺少 frontmatter、缺少字段时安装失败
4. 目标目录已存在时安装失败
5. loader 能读取 `skills/<name>/SKILL.md`
6. loader 继续兼容旧的 `skills/*.md`
7. catalog `reload()` 后能发现新安装的 skill
8. system prompt 包含强制 trigger 规则
9. `skill` 工具返回的新 payload 保留路径、来源和正文

### 回归约束

- 不破坏现有 builtin skills 的加载
- 不破坏现有 `/plan` slash command 路径
- 不破坏项目本地覆盖全局 skill 的现有优先级

---

## 风险与取舍

### 1. 不做文件 watch

优点：

- 实现简单
- 更符合当前 `xiaok` 架构

代价：

- 只有在“下一轮输入前”才会看到新 skill，而不是安装瞬间主动刷新 UI

这是可接受的，因为用户要求的是“安装完后热加载”，不是“当前屏幕立即刷新菜单”。

### 2. 不做远程安装

优点：

- 先把本地安装和协议可靠性做稳
- 降低网络和权限复杂度

代价：

- 还不能像 `codex` 的 `skill-installer` 一样直接从 GitHub 拉 skill

这可以作为后续增量迭代。

### 3. 强制规则仍通过 prompt 生效

优点：

- 不需要重写 agent runtime
- 与当前模型适配层兼容

代价：

- 不如 runtime 级状态机那么强

但相比当前“只有一句建议”，明确协议 + 结构化 skill 注入已经会显著提升稳定性。

---

## 交付顺序

1. 写 spec
2. 写 implementation plan
3. 写失败测试
4. 写最小实现
5. 跑测试与回归

---

## 验收标准

满足以下条件即视为完成：

- `xiaok skill install <local-path>` 可稳定安装 skill
- 安装后的 skill 进入 `~/.xiaok/skills/<name>/SKILL.md`
- 当前 chat 会话下一轮输入可见该 skill
- loader 同时支持目录型 `SKILL.md` 和旧 `.md`
- system prompt 明确包含强制 skill 触发规则
- 新增测试通过，现有 skill 相关测试不回归
