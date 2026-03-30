# xiaok Skill Install And Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xiaok` 增加确定性的本地 skill 安装命令、目录型 `SKILL.md` 加载、安装后热加载，以及强制 skill 触发规则。

**Architecture:** 把 skill 安装拆成一个独立的本地安装模块，负责 source 识别、frontmatter 校验、原子写入标准目标目录。现有 loader 升级为兼容目录型 `skills/<name>/SKILL.md` 和旧的平铺 `.md`，chat 继续在每轮前统一 `reload()`；system prompt 和 `skill` 工具同时升级为强制协议，保证命中 skill 时先加载 skill 再继续。

**Tech Stack:** TypeScript, Node.js, Commander, Vitest, existing `xiaok-cli` runtime

---

## File Structure

- Create: `src/ai/skills/install.ts`
  - 负责本地 skill source 校验、frontmatter 解析、目标目录计算、原子安装。
- Create: `src/commands/skill.ts`
  - 注册 `xiaok skill install <source>` 命令并输出安装结果。
- Modify: `src/index.ts`
  - 注册 skill 子命令。
- Modify: `src/ai/skills/loader.ts`
  - 同时支持目录型 `SKILL.md` 和旧平铺 `.md`，保持现有覆盖优先级。
- Modify: `src/ai/skills/tool.ts`
  - 把 skill 注入格式升级成更强约束的结构化指令块。
- Modify: `src/ai/context/yzj-context.ts`
  - 注入强制 skill 触发规则。
- Modify: `src/commands/chat.ts`
  - 确认继续复用单一 skill catalog 刷新路径，不单独缓存 skill 列表。
- Create: `tests/ai/skills/install.test.ts`
  - 覆盖本地安装成功、失败、目录写入、原子行为。
- Create: `tests/commands/skill.test.ts`
  - 覆盖 `skill install` 命令注册与输出。
- Modify: `tests/ai/skills/loader.test.ts`
  - 覆盖目录型 `SKILL.md` 发现、旧格式兼容、reload 后可见。
- Modify: `tests/ai/skills/tool.test.ts`
  - 覆盖新 skill 注入格式。
- Modify: `tests/ai/context/yzj-context.test.ts`
  - 覆盖强制 skill 触发规则写入系统提示。

---

## Task 1: Lock In Directory-Based Skill Loading

**Files:**
- Modify: `tests/ai/skills/loader.test.ts`
- Modify: `src/ai/skills/loader.ts`

- [ ] **Step 1: 写失败测试，锁定目录型 skill 加载**

```ts
it('loads skills from directory entries with SKILL.md', async () => {
  const deployDir = join(globalDir, 'skills', 'deploy');
  mkdirSync(deployDir, { recursive: true });
  writeFileSync(join(deployDir, 'SKILL.md'), `---
name: deploy
description: 发布技能
---
执行发布检查。`);

  const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });

  expect(skills.find((skill) => skill.name === 'deploy')).toMatchObject({
    name: 'deploy',
    description: '发布技能',
    source: 'global',
    tier: 'user',
    path: join(deployDir, 'SKILL.md'),
  });
});
```

```ts
it('keeps supporting legacy flat markdown skill files', async () => {
  writeFileSync(join(globalDir, 'skills', 'legacy.md'), `---
name: legacy
description: 兼容旧格式
---
Legacy content.`);

  const skills = await loadSkills(globalDir, projectDir, { builtinRoots: [] });

  expect(skills.find((skill) => skill.name === 'legacy')?.path).toContain('legacy.md');
});
```

- [ ] **Step 2: 运行测试，确认当前 loader 不能加载目录型 skill**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- FAIL，目录型 `skills/deploy/SKILL.md` 未被发现
- 旧格式相关测试仍应 PASS

- [ ] **Step 3: 写最小实现，扫描 `skills/*/SKILL.md` 和 `skills/*.md`**

```ts
function loadSkillFile(
  filePath: string,
  source: SkillMeta['source'],
  tier: SkillMeta['tier'],
): SkillMeta | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    if (!parsed) return null;
    return { ...parsed, path: filePath, source, tier };
  } catch {
    return null;
  }
}

function loadSkillsFromDir(
  dir: string,
  source: SkillMeta['source'],
  tier: SkillMeta['tier'],
): SkillMeta[] {
  if (!existsSync(dir)) return [];

  const results: SkillMeta[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const skill = loadSkillFile(join(dir, entry.name), source, tier);
      if (skill) results.push(skill);
      continue;
    }

    if (entry.isDirectory()) {
      const skillPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const skill = loadSkillFile(skillPath, source, tier);
      if (skill) results.push(skill);
    }
  }

  return results;
}
```

- [ ] **Step 4: 运行测试，确认目录型和旧格式都可加载**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai/skills/loader.test.ts src/ai/skills/loader.ts
git commit -m "feat: support directory-based skills"
```

---

## Task 2: Add Local Skill Installer Core

**Files:**
- Create: `tests/ai/skills/install.test.ts`
- Create: `src/ai/skills/install.ts`

- [ ] **Step 1: 写失败测试，锁定安装成功路径**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSkillFromLocalPath } from '../../../src/ai/skills/install.js';

describe('installSkillFromLocalPath', () => {
  let configDir: string;
  let sourceRoot: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `xiaok-skill-config-${Date.now()}`);
    sourceRoot = join(tmpdir(), `xiaok-skill-source-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it('installs a directory-based skill into the canonical target', async () => {
    const sourceDir = join(sourceRoot, 'skill-installer');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'SKILL.md'), `---
name: skill-installer
description: 安装技能
---
Install skill.`);

    const result = await installSkillFromLocalPath(sourceDir, configDir);

    expect(result.name).toBe('skill-installer');
    expect(result.destinationDir).toBe(join(configDir, 'skills', 'skill-installer'));
    expect(result.destinationSkillPath).toBe(join(configDir, 'skills', 'skill-installer', 'SKILL.md'));
    expect(existsSync(result.destinationSkillPath)).toBe(true);
    expect(readFileSync(result.destinationSkillPath, 'utf-8')).toContain('Install skill');
  });
});
```

- [ ] **Step 2: 写失败测试，锁定错误场景**

```ts
it('installs a single markdown file as SKILL.md', async () => {
  const filePath = join(sourceRoot, 'single.md');
  writeFileSync(filePath, `---
name: single-skill
description: 单文件技能
---
Single file content.`);

  const result = await installSkillFromLocalPath(filePath, configDir);

  expect(result.destinationSkillPath).toBe(join(configDir, 'skills', 'single-skill', 'SKILL.md'));
  expect(readFileSync(result.destinationSkillPath, 'utf-8')).toContain('Single file content');
});

it('rejects a directory without SKILL.md', async () => {
  const brokenDir = join(sourceRoot, 'broken');
  mkdirSync(brokenDir, { recursive: true });

  await expect(installSkillFromLocalPath(brokenDir, configDir)).rejects.toThrow('SKILL.md');
});

it('rejects a skill when destination already exists', async () => {
  const filePath = join(sourceRoot, 'dup.md');
  writeFileSync(filePath, `---
name: duplicate
description: 重复
---
content`);
  mkdirSync(join(configDir, 'skills', 'duplicate'), { recursive: true });

  await expect(installSkillFromLocalPath(filePath, configDir)).rejects.toThrow('Destination already exists');
});
```

- [ ] **Step 3: 运行测试，确认安装模块尚不存在**

Run: `npx vitest run tests/ai/skills/install.test.ts`

Expected:

- FAIL，`installSkillFromLocalPath` 不存在

- [ ] **Step 4: 写最小实现，支持目录和单文件安装**

```ts
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { resolve, join, basename } from 'path';
import { parseFrontmatter } from './loader.js';

export interface InstallSkillResult {
  name: string;
  destinationDir: string;
  destinationSkillPath: string;
}

export async function installSkillFromLocalPath(
  source: string,
  configDir: string,
): Promise<InstallSkillResult> {
  const resolved = resolve(source);
  if (!existsSync(resolved)) throw new Error(`Skill source not found: ${resolved}`);

  const parsed = loadSkillSource(resolved);
  const destinationDir = join(configDir, 'skills', parsed.name);
  const destinationSkillPath = join(destinationDir, 'SKILL.md');
  if (existsSync(destinationDir)) throw new Error(`Destination already exists: ${destinationDir}`);

  mkdirSync(join(configDir, 'skills'), { recursive: true });
  const tmpDir = `${destinationDir}.tmp-${Date.now()}`;

  if (parsed.kind === 'directory') {
    cpSync(resolved, tmpDir, { recursive: true });
  } else {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'SKILL.md'), readFileSync(resolved, 'utf-8'), 'utf-8');
  }

  renameSync(tmpDir, destinationDir);
  return { name: parsed.name, destinationDir, destinationSkillPath };
}
```

- [ ] **Step 5: 运行测试，确认安装路径与错误处理稳定**

Run: `npx vitest run tests/ai/skills/install.test.ts`

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add tests/ai/skills/install.test.ts src/ai/skills/install.ts
git commit -m "feat: add local skill installer"
```

---

## Task 3: Expose `xiaok skill install` Command

**Files:**
- Create: `tests/commands/skill.test.ts`
- Create: `src/commands/skill.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 写失败测试，锁定命令注册与输出**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerSkillCommands } from '../../src/commands/skill.js';

describe('registerSkillCommands', () => {
  let configDir: string;
  let sourceDir: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `xiaok-skill-cmd-config-${Date.now()}`);
    sourceDir = join(tmpdir(), `xiaok-skill-cmd-source-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
    vi.restoreAllMocks();
  });

  it('installs a skill from the CLI command', async () => {
    const skillDir = join(sourceDir, 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: demo
description: 演示技能
---
Demo content.`);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    registerSkillCommands(program);

    await program.parseAsync(['skill', 'install', skillDir], { from: 'user' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已安装 skill: demo'));
  });
});
```

- [ ] **Step 2: 运行测试，确认命令尚未注册**

Run: `npx vitest run tests/commands/skill.test.ts`

Expected:

- FAIL，`registerSkillCommands` 不存在

- [ ] **Step 3: 写最小实现并接入 CLI 入口**

```ts
// src/commands/skill.ts
import type { Command } from 'commander';
import { getConfigDir } from '../utils/config.js';
import { installSkillFromLocalPath } from '../ai/skills/install.js';

export function registerSkillCommands(program: Command): void {
  const skill = program.command('skill').description('管理 xiaok skills');

  skill
    .command('install <source>')
    .description('安装本地 skill')
    .action(async (source: string) => {
      try {
        const result = await installSkillFromLocalPath(source, getConfigDir());
        console.log(`已安装 skill: ${result.name}`);
        console.log(`目标路径: ${result.destinationSkillPath}`);
        console.log('当前会话下一轮输入将自动可见该 skill');
      } catch (error) {
        console.error(String(error));
        process.exitCode = 1;
      }
    });
}
```

```ts
// src/index.ts
import { registerSkillCommands } from './commands/skill.js';

registerSkillCommands(program);
```

- [ ] **Step 4: 运行测试，确认命令可安装本地 skill**

Run: `npx vitest run tests/commands/skill.test.ts tests/ai/skills/install.test.ts`

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add tests/commands/skill.test.ts src/commands/skill.ts src/index.ts
git commit -m "feat: add skill install command"
```

---

## Task 4: Enforce Skill Protocol In Prompt And Payload

**Files:**
- Modify: `tests/ai/context/yzj-context.test.ts`
- Modify: `tests/ai/skills/tool.test.ts`
- Modify: `src/ai/context/yzj-context.ts`
- Modify: `src/ai/skills/tool.ts`

- [ ] **Step 1: 写失败测试，锁定系统提示中的强制规则**

```ts
it('includes required skill invocation rules in the system prompt', async () => {
  const prompt = await buildSystemPrompt({
    enterpriseId: null,
    devApp: null,
    cwd: '/tmp/demo',
    budget: 2000,
    skills: [
      {
        name: 'skill-installer',
        description: '安装技能',
        content: 'Install skill.',
        path: '/builtin/skill-installer/SKILL.md',
        source: 'builtin',
        tier: 'system',
      },
    ],
  });

  expect(prompt).toContain('必须先调用 `skill` 工具');
  expect(prompt).toContain('不允许直接回答');
});
```

- [ ] **Step 2: 写失败测试，锁定新的 skill payload 格式**

```ts
it('returns a structured skill instruction envelope', async () => {
  const catalog = createSkillCatalog(dir, dir, { builtinRoots: [] });
  await catalog.reload();
  const tool = createSkillTool(catalog);

  const result = await tool.execute({ name: 'greet' });

  expect(result).toContain('<skill_instructions>');
  expect(result).toContain('<name>greet</name>');
  expect(result).toContain('<source>global</source>');
  expect(result).toContain('当前任务必须先遵守这个 skill');
});
```

- [ ] **Step 3: 运行测试，确认当前 prompt 和 payload 约束不足**

Run: `npx vitest run tests/ai/context/yzj-context.test.ts tests/ai/skills/tool.test.ts`

Expected:

- FAIL，prompt 不包含强制文案
- FAIL，tool 仍返回 JSON

- [ ] **Step 4: 写最小实现，升级 prompt 与 skill 注入**

```ts
// src/ai/context/yzj-context.ts
sections.push([
  '## Skill 使用规则',
  '如果用户显式点名某个 skill，或请求明显匹配某个 skill 描述，必须先调用 `skill` 工具加载该 skill。',
  '在加载 skill 之前，不允许直接回答、不允许直接输出计划、不允许直接执行写入或命令。',
  '如果用户输入 `/skill-name`，必须执行对应 skill。',
].join('\n'));
```

```ts
// src/ai/skills/tool.ts
export function formatSkillPayload(skill: SkillMeta): string {
  return [
    '<skill_instructions>',
    `<name>${skill.name}</name>`,
    `<path>${skill.path}</path>`,
    `<source>${skill.source}</source>`,
    `<tier>${skill.tier}</tier>`,
    '<requirement>当前任务必须先遵守这个 skill，再继续回答或执行操作。</requirement>',
    skill.content,
    '</skill_instructions>',
  ].join('\n');
}
```

- [ ] **Step 5: 运行测试，确认强制协议已写入**

Run: `npx vitest run tests/ai/context/yzj-context.test.ts tests/ai/skills/tool.test.ts`

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add tests/ai/context/yzj-context.test.ts tests/ai/skills/tool.test.ts src/ai/context/yzj-context.ts src/ai/skills/tool.ts
git commit -m "feat: enforce skill invocation protocol"
```

---

## Task 5: Verify Reload Behavior And Regressions

**Files:**
- Modify: `tests/ai/skills/loader.test.ts`
- Modify: `src/commands/chat.ts`

- [ ] **Step 1: 写失败测试，锁定安装后 reload 可见**

```ts
it('reloads a newly installed directory-based skill through the persistent catalog', async () => {
  const catalog = createSkillCatalog(globalDir, projectDir, { builtinRoots: [] });

  await catalog.reload();
  expect(catalog.get('installer')).toBeUndefined();

  const installerDir = join(projectDir, '.xiaok', 'skills', 'installer');
  mkdirSync(installerDir, { recursive: true });
  writeFileSync(join(installerDir, 'SKILL.md'), `---
name: installer
description: 安装器
---
Install stuff.`);

  await catalog.reload();

  expect(catalog.get('installer')).toMatchObject({
    name: 'installer',
    path: join(installerDir, 'SKILL.md'),
    source: 'project',
  });
});
```

- [ ] **Step 2: 运行测试，确认目录型 reload 路径被覆盖**

Run: `npx vitest run tests/ai/skills/loader.test.ts`

Expected:

- PASS 或 FAIL 都可以接受；若 FAIL，修正 loader 直到目录型 reload 稳定

- [ ] **Step 3: 检查 `chat.ts` 是否仍在单一入口刷新 catalog**

```ts
const refreshSkills = async (): Promise<void> => {
  skills = await skillCatalog.reload();
  inputReader.setSkills(skills);
  agent.setSystemPrompt(await buildPrompt(skills));
};
```

If missing or duplicated:

```ts
// 保持 chat 只通过 refreshSkills 更新 skills，
// 不引入额外的本地缓存副本。
```

- [ ] **Step 4: 运行精确回归测试**

Run: `npx vitest run tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts tests/ai/context/yzj-context.test.ts tests/ai/skills/install.test.ts tests/commands/skill.test.ts`

Expected:

- PASS

- [ ] **Step 5: 运行完整 skill 相关测试**

Run: `npx vitest run tests/ai/skills/*.test.ts tests/ai/context/yzj-context.test.ts`

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add tests/ai/skills/loader.test.ts src/commands/chat.ts
git commit -m "test: verify skill reload and regressions"
```

---

## Task 6: Final Verification

**Files:**
- No new files

- [ ] **Step 1: 运行目标测试集**

Run: `npx vitest run tests/ai/skills/install.test.ts tests/commands/skill.test.ts tests/ai/skills/loader.test.ts tests/ai/skills/tool.test.ts tests/ai/context/yzj-context.test.ts`

Expected:

- PASS

- [ ] **Step 2: 运行完整测试集**

Run: `npm test`

Expected:

- PASS

- [ ] **Step 3: 手工验证本地安装命令**

Run:

```bash
mkdir -p /tmp/xiaok-demo-skill
cat > /tmp/xiaok-demo-skill/SKILL.md <<'EOF'
---
name: demo-skill
description: 演示 skill
---
请输出 demo。
EOF

node dist/index.js skill install /tmp/xiaok-demo-skill
```

Expected:

- 输出 `已安装 skill: demo-skill`
- 目标路径位于 `~/.xiaok/skills/demo-skill/SKILL.md`

- [ ] **Step 4: 手工验证热加载**

Run:

```bash
xiaok
```

Then in the running session:

```text
/demo-skill
```

Expected:

- 若安装发生在会话启动前，slash 可直接命中
- 若安装发生在会话运行中，下一轮输入前 reload 后可命中

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add deterministic skill install and enforcement"
```

---

## Self-Review

### Spec coverage

- 确定性安装：Task 2 + Task 3 覆盖
- 目录型 `SKILL.md`：Task 1 覆盖
- 热加载：Task 5 + Task 6 覆盖
- 强制 skill 触发：Task 4 覆盖
- 旧 `.md` 兼容：Task 1 覆盖

### Placeholder scan

- 无 `TODO` / `TBD`
- 每个代码步骤都给出明确文件和示例代码
- 每个验证步骤都给出明确命令与预期结果

### Type consistency

- 安装模块统一导出 `installSkillFromLocalPath`
- CLI 层统一注册 `registerSkillCommands`
- 安装返回值统一使用 `destinationDir` 与 `destinationSkillPath`

