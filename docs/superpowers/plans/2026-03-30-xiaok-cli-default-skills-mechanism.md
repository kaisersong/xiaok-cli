# xiaok-cli Default Skills Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `xiaok-cli` 像 `codex` 一样在启动时天然具备一批系统级默认 skills，同时继续支持项目本地与用户目录扩展，并把 skill 来源聚合进 runtime 能力摘要。

**Architecture:** 新增一层“skill roots 聚合 + 默认 skills 清单”装载逻辑，替代当前只扫 `~/.xiaok/skills` 和 `./.xiaok/skills` 的实现。系统默认 skills 以仓库内置目录提供，loader 统一返回 `source` / `path` / `tier` 元数据，`chat` 与 system prompt 只消费聚合后的能力摘要，不关心 skill 来自哪里。

**Tech Stack:** TypeScript, Node.js, Vitest, existing `xiaok-cli` runtime

---

## Scope

本计划只覆盖默认 skills 机制本身，不包含：

- UI 菜单重做
- plugin 系统
- 远程 skill marketplace
- skill 安装命令

## Recommended Builtin Skills

参考 Claude 的内置官方 skills：

- `update-config`
- `keybindings-help`
- `simplify`
- `loop`
- `claude-api`

结合 `xiaok-cli` 当前定位，建议拆成两层。

### Phase A: 首批直接内置

这些适合直接进入仓库默认 `data/skills/`，因为它们和 `xiaok-cli` 当前 CLI / coding assistant 定位强相关：

- `plan`
  保留。负责任务拆解和实现计划输出。
- `debug`
  保留。负责根因优先的排障路径。
- `review`
  保留。负责 code review / regression / test gap。
- `simplify`
  新增。对齐 Claude 的默认能力，聚焦“减少复杂度、删冗余、收敛接口”。
- `update-config`
  新增。指导用户修改 `settings.json` / 本地配置，不让模型临时编一套配置语义。
- `keybindings-help`
  新增。面向当前终端交互和后续 UI/TUI，统一解释快捷键与自定义方式。

### Phase B: 第二批按能力成熟度接入

这些能力有价值，但应等对应 runtime 更稳定后再内置：

- `loop`
  建议保留为计划内默认 skill 候选，但延后到 “定时/轮询命令执行” 真正落地后再开放，否则模型会频繁调用一个并不存在的交互模式。
- `claude-api`
  不建议按 Claude 命名直接照搬到 `xiaok-cli`。
  更合理的是后续泛化为：
  - `model-api`
  - `llm-api`
  - 或 `agent-api`
  这样不会把默认 skill 绑定到单一厂商。

### Naming Recommendation

对 `xiaok-cli`，建议默认 skill 名称最终收敛为：

- `plan`
- `debug`
- `review`
- `simplify`
- `update-config`
- `keybindings-help`

预留但暂不默认启用：

- `loop`
- `llm-api`（或 `model-api`）

### Rationale

- `plan/debug/review/simplify` 构成“任务规划 -> 问题定位 -> 风险审查 -> 复杂度优化”的基础工作流。
- `update-config` 和 `keybindings-help` 对 CLI 产品尤其关键，能减少模型在配置和交互说明上的随机发挥。
- `loop` 和 `claude-api` 更像 capability-bound skills，必须等真实能力存在后再默认暴露。

## File Structure

- Create: `src/ai/skills/defaults.ts`
  负责默认 skill roots、默认 tier、系统内置 skill 目录解析。
- Modify: `src/ai/skills/loader.ts`
  从“两个固定目录”升级为“多个 roots 聚合 + tier/source/path 元数据”。
- Modify: `src/ai/skills/tool.ts`
  让 skill payload 输出完整来源信息，便于模型理解默认 skill 与用户 skill 的差异。
- Modify: `src/ai/context/yzj-context.ts`
  补 capability summary，明确当前会话可见的默认 skills 与覆盖关系。
- Modify: `src/commands/chat.ts`
  启动时统一装载默认 + 用户 + 项目 skills，并为 slash 提示沿用同一份数据。
- Create: `data/skills/`
  存放系统内置默认 skills 的最小集合，Phase A 先落 `plan/debug/review/simplify/update-config/keybindings-help`。
- Modify: `tests/ai/skills/loader.test.ts`
  覆盖 root 聚合、覆盖优先级、默认 skills 自动装载。
- Modify: `tests/ai/skills/tool.test.ts`
  覆盖结构化 payload 中的来源元数据。
- Modify: `tests/ai/context/yzj-context.test.ts`
  覆盖 capability summary 中的默认 skills 摘要。

## Delivery Sequence

按以下顺序执行，不要跳步：

1. 先锁定 loader 新行为
2. 再引入内置默认 skill roots
3. 再把来源信息接到 runtime / prompt
4. 最后补内置默认 skill 内容

### Task 1: 扩展 SkillMeta，支持来源路径和 tier

**Files:**
- Modify: `src/ai/skills/loader.ts`
- Modify: `tests/ai/skills/loader.test.ts`
- Modify: `tests/ai/skills/tool.test.ts`

- [ ] **Step 1: 写失败测试，锁定新的 skill 元数据**

```ts
// tests/ai/skills/loader.test.ts
it('returns path and tier metadata for loaded skills', async () => {
  writeFileSync(join(globalDir, 'skills', 'hello.md'), `---
name: hello
description: 打招呼
---
Hello.`);

  const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });
  expect(skills[0]).toMatchObject({
    name: 'hello',
    source: 'global',
    tier: 'user',
  });
  expect(skills[0].path).toContain('hello.md');
});
```

```ts
// tests/ai/skills/tool.test.ts
it('returns structured payload with tier metadata', async () => {
  const skills = await loadSkills(dir, dir, { builtinRoots: [] });
  const tool = createSkillTool(skills);
  const payload = JSON.parse(await tool.execute({ name: 'greet' }));

  expect(payload.source).toBe('global');
  expect(payload.tier).toBe('user');
});
```

- [ ] **Step 2: 运行测试，确认当前 `SkillMeta` 不足**

Run: `npx vitest run tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts`

Expected:

- FAIL，因为 `path` / `tier` 不存在

- [ ] **Step 3: 写最小实现，补齐 SkillMeta**

```ts
// src/ai/skills/loader.ts
export interface SkillMeta {
  name: string;
  description: string;
  content: string;
  path: string;
  source: 'builtin' | 'global' | 'project';
  tier: 'system' | 'user' | 'project';
}
```

```ts
function loadSkillsFromDir(
  dir: string,
  source: SkillMeta['source'],
  tier: SkillMeta['tier']
): SkillMeta[] {
  // ...
  results.push({ ...parsed, path: join(dir, file), source, tier });
}
```

- [ ] **Step 4: 运行测试，确认元数据稳定**

Run: `npx vitest run tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts`

Expected:

- PASS

### Task 2: 引入系统默认 skill roots

**Files:**
- Create: `src/ai/skills/defaults.ts`
- Modify: `src/ai/skills/loader.ts`
- Modify: `tests/ai/skills/loader.test.ts`

- [ ] **Step 1: 写失败测试，锁定默认 skills 自动装载**

```ts
// tests/ai/skills/loader.test.ts
it('loads builtin skills before user and project overrides', async () => {
  const builtinDir = join(globalDir, 'builtin');
  mkdirSync(builtinDir, { recursive: true });

  writeFileSync(join(builtinDir, 'review.md'), `---
name: review
description: builtin review
---
Builtin review.`);

  const skills = await loadSkills(globalDir, projectDir, {
    builtinRoots: [builtinDir],
  });

  expect(skills.find((s) => s.name === 'review')?.source).toBe('builtin');
});
```

```ts
it('project skill overrides builtin skill with same name', async () => {
  const builtinDir = join(globalDir, 'builtin');
  mkdirSync(builtinDir, { recursive: true });

  writeFileSync(join(builtinDir, 'review.md'), `---
name: review
description: builtin review
---
Builtin.`);

  writeFileSync(join(projectDir, '.xiaok', 'skills', 'review.md'), `---
name: review
description: project review
---
Project.`);

  const skills = await loadSkills(globalDir, projectDir, {
    builtinRoots: [builtinDir],
  });

  expect(skills.find((s) => s.name === 'review')).toMatchObject({
    source: 'project',
    tier: 'project',
    description: 'project review',
  });
});
```

- [ ] **Step 2: 运行测试，确认当前 loader 不能收 builtin roots**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- FAIL，因为 `loadSkills(..., { builtinRoots })` 尚不支持

- [ ] **Step 3: 写最小实现，引入默认 roots 配置**

```ts
// src/ai/skills/defaults.ts
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getBuiltinSkillRoots(): string[] {
  return [join(__dirname, '../../../data/skills')];
}
```

```ts
// src/ai/skills/loader.ts
import { getBuiltinSkillRoots } from './defaults.js';

export async function loadSkills(
  xiaokConfigDir = join(homedir(), '.xiaok'),
  cwd = process.cwd(),
  options?: { builtinRoots?: string[] }
): Promise<SkillMeta[]> {
  const builtinRoots = options?.builtinRoots ?? getBuiltinSkillRoots();

  const builtinSkills = builtinRoots.flatMap((root) =>
    loadSkillsFromDir(root, 'builtin', 'system')
  );
  const globalSkills = loadSkillsFromDir(join(xiaokConfigDir, 'skills'), 'global', 'user');
  const projectSkills = loadSkillsFromDir(join(cwd, '.xiaok', 'skills'), 'project', 'project');

  const map = new Map<string, SkillMeta>();
  for (const skill of builtinSkills) map.set(skill.name, skill);
  for (const skill of globalSkills) map.set(skill.name, skill);
  for (const skill of projectSkills) map.set(skill.name, skill);
  return [...map.values()];
}
```

- [ ] **Step 4: 运行测试，确认默认 roots 与覆盖顺序稳定**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- PASS

### Task 3: 让 runtime 明确展示默认 skills 能力摘要

**Files:**
- Modify: `src/ai/context/yzj-context.ts`
- Modify: `src/commands/chat.ts`
- Modify: `tests/ai/context/yzj-context.test.ts`

- [ ] **Step 1: 写失败测试，锁定 system prompt 中的默认 skills 摘要**

```ts
// tests/ai/context/yzj-context.test.ts
it('includes builtin skill summary in the system prompt', async () => {
  const prompt = await buildSystemPrompt({
    enterpriseId: null,
    devApp: null,
    cwd: '/tmp/demo',
    budget: 2000,
    skills: [
      {
        name: 'review',
        description: 'review code',
        content: 'Do review',
        path: '/builtin/review.md',
        source: 'builtin',
        tier: 'system',
      },
    ],
  });

  expect(prompt).toContain('默认 Skills');
  expect(prompt).toContain('/review');
});
```

- [ ] **Step 2: 运行测试，确认当前 prompt 不区分默认 skills**

Run: `npx vitest run tests/ai/context/yzj-context.test.ts`

Expected:

- FAIL，因为当前只列出通用 skills 列表

- [ ] **Step 3: 写最小实现，把 skill tier 注入 capability summary**

```ts
// src/ai/context/yzj-context.ts
function formatSkillCapabilitySummary(skills: SkillMeta[]): string {
  const builtin = skills.filter((skill) => skill.tier === 'system');
  const custom = skills.filter((skill) => skill.tier !== 'system');

  const sections: string[] = [];
  if (builtin.length > 0) {
    sections.push(`## 默认 Skills\n\n${builtin.map((skill) => `- /${skill.name}: ${skill.description}`).join('\n')}`);
  }
  if (custom.length > 0) {
    sections.push(`## 扩展 Skills\n\n${custom.map((skill) => `- /${skill.name}: ${skill.description}`).join('\n')}`);
  }
  return sections.join('\n\n');
}
```

```ts
// src/commands/chat.ts
const skills = await loadSkills();
// 后续 slash menu / skill tool / prompt 全部复用这一个聚合结果
```

- [ ] **Step 4: 运行测试，确认能力摘要可见**

Run: `npx vitest run tests/ai/context/yzj-context.test.ts tests/ai/skills/tool.test.ts`

Expected:

- PASS

### Task 4: 补首批默认 skills 内容

**Files:**
- Create: `data/skills/review.md`
- Create: `data/skills/plan.md`
- Create: `data/skills/debug.md`
- Create: `data/skills/simplify.md`
- Create: `data/skills/update-config.md`
- Create: `data/skills/keybindings-help.md`
- Modify: `tests/ai/skills/loader.test.ts`

- [ ] **Step 1: 写失败测试，锁定仓库默认 skill 目录能被真实读取**

```ts
// tests/ai/skills/loader.test.ts
it('loads builtin skills from the repository data directory', async () => {
  const skills = await loadSkills(globalDir, projectDir);
  expect(skills.some((skill) => skill.source === 'builtin')).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认仓库默认 skills 目录为空时不满足断言**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- FAIL，因为 `data/skills/` 还不存在或为空

- [ ] **Step 3: 写最小默认 skill 内容**

```md
---
name: review
description: 对当前改动做实现级审查，优先找 bug、回归和测试缺口
---
你现在处于 code review 模式。
先列 findings，再给简短总结。
```

```md
---
name: plan
description: 把多步骤需求整理成可执行计划
---
你现在处于 planning 模式。
先收敛范围，再输出可执行步骤。
```

```md
---
name: debug
description: 先定位根因，再提出修复方案
---
你现在处于 debugging 模式。
不要先改代码，先描述根因假设和验证路径。
```

```md
---
name: simplify
description: 识别可删减的复杂度，优先做小而稳的重构
---
你现在处于 simplify 模式。
优先删除重复、收敛分支、缩小接口面，不要先扩功能。
```

```md
---
name: update-config
description: 帮助用户理解并修改 xiaok 的 settings/config 配置
---
你现在处于 config 模式。
先说明配置项作用、默认值和风险，再给出建议修改。
```

```md
---
name: keybindings-help
description: 解释当前 CLI 或 TUI 的快捷键及自定义方式
---
你现在处于 keybindings help 模式。
先说明现有快捷键，再说明如何调整或扩展。
```

- [ ] **Step 4: 运行测试，确认默认 skills 可被真实装载**

Run: `npx vitest run tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts tests/ai/context/yzj-context.test.ts`

Expected:

- PASS

## Integration Verification

- [ ] 运行 skills 相关测试

Run: `npx vitest run tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts tests/ai/skills/slash.test.ts tests/ai/context/yzj-context.test.ts`

Expected:

- 全部 PASS

- [ ] 运行完整测试集

Run: `npx vitest run`

Expected:

- 全部 PASS

- [ ] 构建项目

Run: `npm run build`

Expected:

- TypeScript build 成功

## Risks

- 默认 skills 一旦直接进入 prompt，过多内容会侵占 `contextBudget`
- 如果默认 skill 名称和项目本地 skill 冲突，覆盖顺序必须稳定且可解释
- 当前 `xiaok-cli` 还没有 plugin system，默认 roots 设计不能提前绑死未来扩展接口

## Rollback Strategy

- 若默认 skills 内容不稳定：保留 root 聚合逻辑，暂时清空 `data/skills/`
- 若 prompt 过长：保留 loader 元数据，回退 capability summary 展示
- 若覆盖顺序引发歧义：保留 tier/path 元数据，回退自动 builtin 装载

## Follow-Up Plan Candidates

- 为 skill 增加 `tags` / `triggers` / `whenToUse`
- 增加 `xiaok skills list` / `xiaok skills doctor`
- 把 skills roots 聚合并入未来 plugin capability summary
- 在 `loop` runtime 落地后补 `data/skills/loop.md`
- 在模型接入层稳定后评估 `llm-api` / `model-api` 默认 skill
