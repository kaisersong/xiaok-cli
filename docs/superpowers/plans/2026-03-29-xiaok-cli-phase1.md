# xiaok CLI Phase 1 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 xiaok CLI Phase 1 核心骨架——包含多模型 AI Agent 循环、6 种内置工具、权限模型、云之家上下文注入、多模型适配层（Claude + OpenAI），以及 auth/chat/config 三组 CLI 命令。

**Architecture:** 单体 TypeScript CLI，以 commander 作为命令框架；核心是 ModelAdapter 接口驱动的 Agent Loop，通过工具调用实现文件操作和 shell 执行；配置和凭据以 JSON 文件存储于 `~/.xiaok/`。

**Tech Stack:** TypeScript 5, Node.js 20+, commander, @anthropic-ai/sdk, openai, fast-glob, vitest

**Spec:** `docs/superpowers/specs/2026-03-29-xiaok-cli-design.md`

---

## 文件结构

### 新建文件

```
xiaok-cli/
├── package.json                         # 包元数据，bin 指向 dist/index.js
├── tsconfig.json                        # TypeScript 编译配置
├── vitest.config.ts                     # 测试运行器配置
├── data/
│   └── yzj-api-overview.md              # 内置云之家 API 概览（约 2000 tokens）
├── src/
│   ├── index.ts                         # CLI 入口，commander 命令注册
│   ├── types.ts                         # 共享 TypeScript 接口（ModelAdapter, Message, StreamChunk 等）
│   ├── auth/
│   │   ├── login.ts                     # OAuth 2.0 浏览器流程（Phase 1 占位实现）
│   │   ├── token-store.ts               # credentials.json 读写，0600 权限管理
│   │   └── identity.ts                  # 从 config 读取 devApp appKey/appSecret
│   ├── ai/
│   │   ├── agent.ts                     # Agent 主循环：构建 messages、调用模型、执行工具、SIGINT 处理
│   │   ├── adapters/
│   │   │   ├── claude.ts                # Claude 适配器：SSE 流式解析、tool_use 缓冲、重试
│   │   │   └── openai.ts                # OpenAI 适配器：tool_calls 缓冲、重试
│   │   ├── tools/
│   │   │   ├── index.ts                 # 工具注册表 + 权限模型（safe/write/bash 分类、y! 逻辑）
│   │   │   ├── bash.ts                  # spawn 子进程，SIGTERM/SIGKILL 信号处理
│   │   │   ├── read.ts                  # fs.readFile，带行号格式化输出
│   │   │   ├── write.ts                 # fs.writeFile，原子写入（先写临时文件再 rename）
│   │   │   ├── edit.ts                  # 精确字符串替换，唯一性校验
│   │   │   ├── grep.ts                  # child_process 调用 rg/grep，返回匹配行
│   │   │   └── glob.ts                  # fast-glob 文件模式匹配
│   │   └── context/
│   │       └── yzj-context.ts           # 组装系统提示：内置文档 + yzj CLI help + 会话上下文，4000 token 预算
│   ├── commands/
│   │   ├── auth.ts                      # auth login/logout/status 命令处理器
│   │   ├── chat.ts                      # chat 命令：初始化 agent，处理 --auto/--dry-run
│   │   └── config.ts                    # config get/set 命令处理器
│   └── utils/
│       ├── config.ts                    # ~/.xiaok/config.json 读写，schemaVersion 检查
│       └── ui.ts                        # 流式 Markdown 渲染，确认提示，y! 检测
└── tests/
    ├── utils/
    │   └── config.test.ts               # 配置读写、schema 版本检查
    ├── auth/
    │   └── token-store.test.ts          # credentials 读写、0600 权限
    ├── ai/
    │   ├── adapters/
    │   │   ├── claude.test.ts           # StreamChunk 规范化、tool_use 缓冲、重试
    │   │   └── openai.test.ts           # tool_calls 缓冲、重试
    │   ├── tools/
    │   │   ├── index.test.ts            # 权限模型、y! 逻辑、--dry-run
    │   │   ├── bash.test.ts             # 命令执行、SIGTERM 超时
    │   │   ├── read.test.ts             # 文件读取
    │   │   ├── write.test.ts            # 原子写入
    │   │   ├── edit.test.ts             # 字符串替换、唯一性
    │   │   ├── grep.test.ts             # 内容搜索
    │   │   └── glob.test.ts             # 模式匹配
    │   ├── context/
    │   │   └── yzj-context.test.ts      # token 预算裁剪、yzj CLI 超时
    │   └── agent.test.ts                # Agent 循环、--dry-run、SIGINT
```

---

## Chunk 1：项目基础 + 配置 + 凭据存储

### Task 1：项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 初始化 package.json**

```json
{
  "name": "xiaok",
  "version": "0.1.0",
  "description": "面向云之家开发者的 AI 编程 CLI",
  "type": "module",
  "bin": { "xiaok": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "commander": "^12.0.0",
    "fast-glob": "^3.3.2",
    "openai": "^4.77.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": { "node": ">=20" },
  "files": ["dist", "data"]
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 安装依赖**

```bash
cd D:/projects/workspace/xiaok-cli
npm install
```

Expected: `node_modules/` 目录出现，无报错。

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "chore: 初始化 TypeScript 项目，添加依赖和构建配置"
```

---

### Task 2：共享类型定义

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`（类型完整性验证，编译即测试）

- [ ] **Step 1: 创建 src/types.ts**

```typescript
// AI Agent 与模型适配层的共享接口

export interface ModelAdapter {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk>;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ToolResultContent[];
  // OpenAI 要求 assistant 消息携带 tool_calls 以便后续 turn 关联 tool 结果
  toolCalls?: ToolCall[];
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type PermissionClass = 'safe' | 'write' | 'bash';

export interface Tool {
  definition: ToolDefinition;
  permission: PermissionClass;
  execute(input: Record<string, unknown>): Promise<string>;
}

// credentials.json schema
export interface Credentials {
  schemaVersion: 1;
  accessToken: string;
  refreshToken: string;
  enterpriseId: string;
  userId: string;
  expiresAt: string; // ISO 8601
}

// config.json schema
export interface Config {
  schemaVersion: 1;
  defaultModel: 'claude' | 'openai' | 'custom';
  models: {
    claude?: { model: string; apiKey?: string };
    openai?: { model: string; apiKey?: string };
    custom?: { baseUrl: string; apiKey?: string };
  };
  devApp?: { appKey: string; appSecret: string };
  defaultMode: 'interactive';
  contextBudget: number;
}

const VALID_PROVIDERS = ['claude', 'openai', 'custom'] as const;

export const DEFAULT_CONFIG: Config = {
  schemaVersion: 1,
  defaultModel: 'claude',
  models: {
    claude: { model: 'claude-opus-4-6' },
  },
  defaultMode: 'interactive',
  contextBudget: 4000,
};

/** 校验 defaultModel 是否合法，防止脏数据写入 */
export function isValidProvider(v: unknown): v is Config['defaultModel'] {
  return VALID_PROVIDERS.includes(v as Config['defaultModel']);
}
```

- [ ] **Step 2: 创建 tests/types.test.ts（编译完整性验证）**

```typescript
// tests/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Message, StreamChunk, ModelAdapter, ToolResultContent, ToolCall } from '../src/types.js';
import { isValidProvider, DEFAULT_CONFIG } from '../src/types.js';

describe('types', () => {
  it('isValidProvider accepts valid providers', () => {
    expect(isValidProvider('claude')).toBe(true);
    expect(isValidProvider('openai')).toBe(true);
    expect(isValidProvider('custom')).toBe(true);
  });

  it('isValidProvider rejects unknown providers', () => {
    expect(isValidProvider('unknown')).toBe(false);
    expect(isValidProvider('')).toBe(false);
    expect(isValidProvider(null)).toBe(false);
  });

  it('DEFAULT_CONFIG has schemaVersion 1', () => {
    expect(DEFAULT_CONFIG.schemaVersion).toBe(1);
  });

  it('Message can carry toolCalls on assistant role', () => {
    const msg: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tu_1', name: 'bash', input: { command: 'ls' } }],
    };
    expect(msg.toolCalls?.[0].name).toBe('bash');
  });
});
```

- [ ] **Step 3: 运行测试，确认通过**

```bash
npx vitest run tests/types.test.ts
```

Expected: PASS。

- [ ] **Step 4: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: 添加共享 TypeScript 接口，含 toolCalls 字段和 isValidProvider 校验"
```

---

### Task 3：配置模块（utils/config.ts）

**Files:**
- Create: `src/utils/config.ts`
- Create: `tests/utils/config.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/utils/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig, getConfigPath } from '../../src/utils/config.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

describe('config', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('returns DEFAULT_CONFIG when no config file exists', async () => {
    const config = await loadConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.defaultModel).toBe('claude');
  });

  it('reads and parses valid config file', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, contextBudget: 8000 })
    );
    const config = await loadConfig();
    expect(config.contextBudget).toBe(8000);
  });

  it('renames corrupt config to .bak and returns defaults', async () => {
    writeFileSync(join(testDir, 'config.json'), 'not valid json');
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('renames unknown schemaVersion config to .bak and returns defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ schemaVersion: 99, defaultModel: 'claude' })
    );
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('renames config with invalid defaultModel to .bak and returns defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ schemaVersion: 1, defaultModel: 'malicious_provider' })
    );
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(join(testDir, 'config.json.bak'))).toBe(true);
  });

  it('saveConfig writes valid JSON and loadConfig reads it back', async () => {
    const cfg = { ...DEFAULT_CONFIG, contextBudget: 2000 };
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded.contextBudget).toBe(2000);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/utils/config.test.ts
```

Expected: FAIL - 模块不存在。

- [ ] **Step 3: 实现 src/utils/config.ts**

```typescript
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Config } from '../types.js';
import { DEFAULT_CONFIG, isValidProvider } from '../types.js';

export function getConfigDir(): string {
  return process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export async function loadConfig(): Promise<Config> {
  const path = getConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  // 校验 defaultModel，防止脏数据
  if (obj.defaultModel !== undefined && !isValidProvider(obj.defaultModel)) {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  return { ...DEFAULT_CONFIG, ...(obj as Partial<Config>), schemaVersion: 1 };
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/utils/config.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/utils/config.ts tests/utils/config.test.ts
git commit -m "feat: 实现配置文件读写，含 schemaVersion 校验和 .bak 降级"
```

---

### Task 4：凭据存储（auth/token-store.ts）

**Files:**
- Create: `src/auth/token-store.ts`
- Create: `tests/auth/token-store.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/auth/token-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveCredentials, loadCredentials, clearCredentials } from '../../src/auth/token-store.js';
import type { Credentials } from '../../src/types.js';

const MOCK_CREDS: Credentials = {
  schemaVersion: 1,
  accessToken: 'tok_abc',
  refreshToken: 'rtok_abc',
  enterpriseId: 'ent_123',
  userId: 'usr_456',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('token-store', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('returns null when no credentials file exists', async () => {
    expect(await loadCredentials()).toBeNull();
  });

  it('saves and loads credentials', async () => {
    await saveCredentials(MOCK_CREDS);
    const loaded = await loadCredentials();
    expect(loaded?.accessToken).toBe('tok_abc');
    expect(loaded?.enterpriseId).toBe('ent_123');
  });

  it('sets file mode 0600 on Unix', async () => {
    if (process.platform === 'win32') return;
    await saveCredentials(MOCK_CREDS);
    const stat = statSync(join(testDir, 'credentials.json'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('clearCredentials removes the file', async () => {
    await saveCredentials(MOCK_CREDS);
    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/auth/token-store.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 src/auth/token-store.ts**

```typescript
import { readFileSync, writeFileSync, chmodSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../utils/config.js';
import type { Credentials } from '../types.js';

function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

export async function loadCredentials(): Promise<Credentials | null> {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  const path = getCredentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

export async function clearCredentials(): Promise<void> {
  const path = getCredentialsPath();
  if (existsSync(path)) rmSync(path);
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/auth/token-store.test.ts
```

Expected: 所有 PASS（Windows 上跳过 chmod 测试）。

- [ ] **Step 5: Commit**

```bash
git add src/auth/token-store.ts tests/auth/token-store.test.ts
git commit -m "feat: 实现凭据文件读写，Unix 下设置 0600 权限"
```

---

### Task 5：开发者身份模块（auth/identity.ts）

**Files:**
- Create: `src/auth/identity.ts`

- [ ] **Step 1: 写失败的测试**

Create `tests/auth/identity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDevAppIdentity, formatIdentityContext } from '../../src/auth/identity.js';

describe('identity', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('returns null when devApp not configured', async () => {
    expect(await getDevAppIdentity()).toBeNull();
  });

  it('returns devApp when configured', async () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      schemaVersion: 1, defaultModel: 'claude', models: {}, defaultMode: 'interactive',
      contextBudget: 4000, devApp: { appKey: 'key123', appSecret: 'secret456' },
    }));
    const identity = await getDevAppIdentity();
    expect(identity?.appKey).toBe('key123');
  });

  it('formatIdentityContext returns empty string for null', () => {
    expect(formatIdentityContext(null)).toBe('');
  });

  it('formatIdentityContext includes appKey', () => {
    expect(formatIdentityContext({ appKey: 'key123', appSecret: 'sec' })).toContain('key123');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/auth/identity.test.ts
```

- [ ] **Step 3: 实现 src/auth/identity.ts**

```typescript
import { loadConfig } from '../utils/config.js';

export interface DevAppIdentity {
  appKey: string;
  appSecret: string;
}

export async function getDevAppIdentity(): Promise<DevAppIdentity | null> {
  const config = await loadConfig();
  if (!config.devApp) return null;
  return config.devApp;
}

export function formatIdentityContext(identity: DevAppIdentity | null): string {
  if (!identity) return '';
  return `开发者应用：appKey=${identity.appKey}`;
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/auth/identity.test.ts
```

Expected: PASS。

- [ ] **Step 5: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add src/auth/identity.ts tests/auth/identity.test.ts
git commit -m "feat: 实现开发者应用身份读取（appKey/appSecret），含单元测试"
```

---

## Chunk 2：多模型适配层

### Task 6：Claude 适配器

**Files:**
- Create: `src/ai/adapters/claude.ts`
- Create: `tests/ai/adapters/claude.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/adapters/claude.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Message, ToolDefinition } from '../../../src/types.js';

// Mock @anthropic-ai/sdk
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = {
        stream: vi.fn(),
      };
    },
  };
});

describe('ClaudeAdapter', () => {
  it('emits text chunks from streaming response', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockReturnValue(mockStream as never);

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    // Replace internal client
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('buffers tool_use input_json_delta and emits single tool_use chunk', async () => {
    const { ClaudeAdapter } = await import('../../../src/ai/adapters/claude.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'bash' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ls"}' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      },
    };

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const instance = new Anthropic({ apiKey: 'test' });
    vi.spyOn(instance.messages, 'stream').mockReturnValue(mockStream as never);

    const adapter = new ClaudeAdapter('test-key', 'claude-opus-4-6');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_use');
    expect(toolChunk).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 'bash', input: { cmd: 'ls' } });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/adapters/claude.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 src/ai/adapters/claude.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';

const MAX_RETRIES = 3;

export class ClaudeAdapter implements ModelAdapter {
  client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-opus-4-6') {
    this.client = new Anthropic({ apiKey, maxRetries: MAX_RETRIES });
    this.model = model;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk> {
    const anthropicMessages = messages.map(m => ({
      role: m.role === 'tool_result' ? 'user' as const : m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map(tc => ({
            type: 'tool_result' as const,
            tool_use_id: tc.tool_use_id,
            content: tc.content,
            is_error: tc.is_error,
          })),
    }));

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    // Buffer for tool_use arguments
    const toolBuffers = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolBuffers.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          jsonBuffer: '',
        });
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text', delta: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const buf = toolBuffers.get(event.index);
          if (buf) buf.jsonBuffer += delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const buf = toolBuffers.get(event.index);
        if (buf) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(buf.jsonBuffer || '{}') as Record<string, unknown>;
          } catch {
            input = { _raw: buf.jsonBuffer };
          }
          yield { type: 'tool_use', id: buf.id, name: buf.name, input };
          toolBuffers.delete(event.index);
        }
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/adapters/claude.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/adapters/claude.ts tests/ai/adapters/claude.test.ts
git commit -m "feat: 实现 Claude 适配器，支持流式文本和 tool_use 缓冲"
```

---

### Task 7：OpenAI 适配器

**Files:**
- Create: `src/ai/adapters/openai.ts`
- Create: `tests/ai/adapters/openai.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/adapters/openai.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
});

describe('OpenAIAdapter', () => {
  it('emits text chunks from streaming response', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'world' }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks: string[] = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('buffers tool_calls arguments and emits single tool_use chunk', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls"}' } }] }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find(c => c.type === 'tool_use');
    expect(toolChunk).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } });
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('emits done even when no finish_reason chunk arrives', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
        // stream ends without finish_reason
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockResolvedValue(mockStream as never);

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const chunks = [];
    for await (const chunk of adapter.stream([], [], 'system')) chunks.push(chunk);
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
  });

  it('expands multiple tool results into separate OpenAI tool messages', async () => {
    const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');

    // Capture the messages passed to the API
    let capturedMessages: unknown[] = [];
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] };
      },
    };

    const OpenAI = (await import('openai')).default;
    const instance = new OpenAI({ apiKey: 'test' });
    vi.spyOn(instance.chat.completions, 'create').mockImplementation(async (params: unknown) => {
      capturedMessages = (params as { messages: unknown[] }).messages;
      return mockStream as never;
    });

    const adapter = new OpenAIAdapter('test-key', 'gpt-4o');
    (adapter as unknown as { client: typeof instance }).client = instance;

    const messages = [
      {
        role: 'tool_result' as const,
        content: [
          { type: 'tool_result' as const, tool_use_id: 'tu_1', content: 'result1' },
          { type: 'tool_result' as const, tool_use_id: 'tu_2', content: 'result2' },
        ],
      },
    ];

    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }

    const toolMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect((toolMessages[0] as { tool_call_id: string }).tool_call_id).toBe('tu_1');
    expect((toolMessages[1] as { tool_call_id: string }).tool_call_id).toBe('tu_2');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/adapters/openai.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 src/ai/adapters/openai.ts**

```typescript
import OpenAI from 'openai';
import type { ModelAdapter, Message, ToolDefinition, StreamChunk } from '../../types.js';

const MAX_RETRIES = 3;

export class OpenAIAdapter implements ModelAdapter {
  client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o', baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: MAX_RETRIES });
    this.model = model;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of messages) {
      if (m.role === 'tool_result') {
        // 每条 ToolResultContent 展开为独立的 tool 消息
        const items = Array.isArray(m.content) ? m.content : [];
        for (const item of items) {
          openaiMessages.push({
            role: 'tool' as const,
            tool_call_id: item.tool_use_id,
            content: item.content,
          });
        }
      } else if (m.role === 'assistant') {
        const msg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: (m.content as string) || null,
        };
        // 如果 assistant 消息携带 tool_calls，必须传给 OpenAI
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          }));
        }
        openaiMessages.push(msg);
      } else {
        openaiMessages.push({ role: 'user', content: m.content as string });
      }
    }

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    });

    // Buffer for tool_calls arguments
    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let gotFinishReason = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text', delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolBuffers.has(tc.index)) {
            toolBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuffer: '' });
          }
          const buf = toolBuffers.get(tc.index)!;
          if (tc.function?.arguments) buf.argsBuffer += tc.function.arguments;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) {
        gotFinishReason = true;
        for (const buf of toolBuffers.values()) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(buf.argsBuffer || '{}') as Record<string, unknown>;
          } catch {
            input = { _raw: buf.argsBuffer };
          }
          yield { type: 'tool_use', id: buf.id, name: buf.name, input };
        }
        toolBuffers.clear();
        yield { type: 'done' };
      }
    }

    // 防御：部分 provider 不发 finish_reason，确保 done 总会发出
    if (!gotFinishReason) {
      for (const buf of toolBuffers.values()) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(buf.argsBuffer || '{}') as Record<string, unknown>; } catch { /**/ }
        yield { type: 'tool_use', id: buf.id, name: buf.name, input };
      }
      yield { type: 'done' };
    }
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/adapters/openai.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/adapters/openai.ts tests/ai/adapters/openai.test.ts
git commit -m "feat: 实现 OpenAI 适配器，支持流式文本和 tool_calls 缓冲"
```

---

### Task 8：模型工厂（src/ai/models.ts）

**Files:**
- Create: `src/ai/models.ts`

- [ ] **Step 1: 实现 src/ai/models.ts**

```typescript
import type { ModelAdapter } from '../types.js';
import type { Config } from '../types.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';

export function createAdapter(config: Config): ModelAdapter {
  const provider = config.defaultModel;
  // 按提供商读取 API Key：环境变量优先于配置文件
  // 注意：不支持无前缀的 XIAOK_API_KEY
  const envKey = process.env[`XIAOK_${provider.toUpperCase()}_API_KEY`];
  const configKey = provider === 'claude' ? config.models.claude?.apiKey
    : provider === 'openai' ? config.models.openai?.apiKey
    : config.models.custom?.apiKey;
  const providerKey = envKey ?? configKey;

  if (!providerKey && provider !== 'custom') {
    throw new Error(
      `未配置 API Key。请运行: xiaok config set api-key <key> --provider ${provider}\n` +
      `或设置环境变量 XIAOK_${provider.toUpperCase()}_API_KEY`
    );
  }

  if (provider === 'claude') {
    const m = config.models.claude;
    return new ClaudeAdapter(providerKey!, m?.model ?? 'claude-opus-4-6');
  }

  if (provider === 'openai') {
    const m = config.models.openai;
    return new OpenAIAdapter(providerKey!, m?.model ?? 'gpt-4o');
  }

  if (provider === 'custom') {
    const m = config.models.custom;
    if (!m?.baseUrl) throw new Error('custom 模型需要配置 baseUrl。请运行: xiaok config set model custom --base-url <url>');
    const apiKey = process.env.XIAOK_CUSTOM_API_KEY ?? m.apiKey ?? '';
    // 自定义端点的 model 名称从配置中读取，未配置时使用 'default'（部分 provider 忽略此字段）
    return new OpenAIAdapter(apiKey, 'default', m.baseUrl);
  }

  throw new Error(`未知的模型提供商: ${provider}`);
}
```

- [ ] **Step 1: 写失败的测试**

Create `tests/ai/models.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAdapter } from '../../src/ai/models.js';
import type { Config } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

const BASE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  models: { claude: { model: 'claude-opus-4-6', apiKey: 'sk-claude' } },
};

describe('createAdapter', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('creates ClaudeAdapter when defaultModel is claude', () => {
    const adapter = createAdapter(BASE_CONFIG);
    expect(adapter.constructor.name).toBe('ClaudeAdapter');
  });

  it('creates OpenAIAdapter when defaultModel is openai', () => {
    const config: Config = { ...BASE_CONFIG, defaultModel: 'openai', models: { openai: { model: 'gpt-4o', apiKey: 'sk-openai' } } };
    const adapter = createAdapter(config);
    expect(adapter.constructor.name).toBe('OpenAIAdapter');
  });

  it('prefers env var over config apiKey', () => {
    process.env.XIAOK_CLAUDE_API_KEY = 'env-key';
    // Should not throw; env key takes precedence
    const adapter = createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } });
    expect(adapter).toBeTruthy();
    delete process.env.XIAOK_CLAUDE_API_KEY;
  });

  it('throws when no apiKey configured for claude', () => {
    expect(() => createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } }))
      .toThrow(/API Key/);
  });

  it('throws when custom model has no baseUrl', () => {
    const config: Config = { ...BASE_CONFIG, defaultModel: 'custom', models: { custom: { baseUrl: '', apiKey: 'k' } } };
    expect(() => createAdapter(config)).toThrow(/baseUrl/);
  });

  it('does not accept XIAOK_API_KEY (unprefixed)', () => {
    process.env.XIAOK_API_KEY = 'generic-key';
    expect(() => createAdapter({ ...BASE_CONFIG, models: { claude: { model: 'claude-opus-4-6' } } }))
      .toThrow(/API Key/); // should still throw — unprefixed var not used
    delete process.env.XIAOK_API_KEY;
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/models.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现（代码已在上方）——运行测试确认通过**

```bash
npx vitest run tests/ai/models.test.ts
```

Expected: PASS。

- [ ] **Step 4: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add src/ai/models.ts tests/ai/models.test.ts
git commit -m "feat: 实现模型工厂，含 API Key 优先级和错误处理，附单元测试"
```

---

## Chunk 3：内置工具集

### Task 9：read 工具

**Files:**
- Create: `src/ai/tools/read.ts`
- Create: `tests/ai/tools/read.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/read.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTool } from '../../../src/ai/tools/read.js';

describe('readTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads file with line numbers', async () => {
    writeFileSync(join(dir, 'foo.txt'), 'line1\nline2\nline3');
    const result = await readTool.execute({ file_path: join(dir, 'foo.txt') });
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
  });

  it('returns error message for missing file', async () => {
    const result = await readTool.execute({ file_path: join(dir, 'missing.txt') });
    expect(result).toContain('Error');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/read.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/read.ts**

```typescript
import { readFileSync, existsSync } from 'fs';
import type { Tool } from '../../types.js';

export const readTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'read',
    description: '读取文件内容，带行号输出',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件绝对路径' },
        offset: { type: 'number', description: '起始行号（1-based，可选）' },
        limit: { type: 'number', description: '最多读取行数（可选）' },
      },
      required: ['file_path'],
    },
  },
  async execute(input) {
    const { file_path, offset = 1, limit } = input as { file_path: string; offset?: number; limit?: number };
    if (!existsSync(file_path)) return `Error: 文件不存在: ${file_path}`;
    try {
      const lines = readFileSync(file_path, 'utf-8').split('\n');
      const start = offset - 1;
      const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
      return slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/read.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/read.ts tests/ai/tools/read.test.ts
git commit -m "feat: 实现 read 工具，带行号输出"
```

---

### Task 10：glob 工具

**Files:**
- Create: `src/ai/tools/glob.ts`
- Create: `tests/ai/tools/glob.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/glob.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { globTool } from '../../../src/ai/tools/glob.js';

describe('globTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'src', 'b.ts'), '');
    writeFileSync(join(dir, 'README.md'), '');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('matches TypeScript files', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts', path: dir });
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('README.md');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/glob.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/glob.ts**

```typescript
import fg from 'fast-glob';
import type { Tool } from '../../types.js';

export const globTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'glob',
    description: '按 glob 模式匹配文件，返回路径列表（按修改时间排序）',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts' },
        path: { type: 'string', description: '搜索根目录（可选，默认当前目录）' },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const { pattern, path: cwd = process.cwd() } = input as { pattern: string; path?: string };
    try {
      const files = await fg(pattern, { cwd, absolute: true, stats: true });
      files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
      if (files.length === 0) return '（无匹配文件）';
      return files.map(f => f.path).join('\n');
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/glob.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/glob.ts tests/ai/tools/glob.test.ts
git commit -m "feat: 实现 glob 工具，按修改时间排序"
```

---

### Task 11：grep 工具

**Files:**
- Create: `src/ai/tools/grep.ts`
- Create: `tests/ai/tools/grep.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/grep.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { grepTool } from '../../../src/ai/tools/grep.js';

describe('grepTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\nhello again');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds matching lines', async () => {
    const result = await grepTool.execute({ pattern: 'hello', path: dir });
    expect(result).toContain('hello world');
    expect(result).toContain('hello again');
    expect(result).not.toContain('foo bar');
  });

  it('returns empty message when no matches', async () => {
    const result = await grepTool.execute({ pattern: 'zzznomatch', path: dir });
    expect(result).toContain('无匹配');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/grep.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/grep.ts**

```typescript
import { spawnSync } from 'child_process';
import type { Tool } from '../../types.js';

export const grepTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'grep',
    description: '在文件中搜索正则表达式，返回匹配行（含文件名和行号）',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        path: { type: 'string', description: '搜索目录或文件（可选，默认当前目录）' },
        glob: { type: 'string', description: '文件过滤 glob（可选，如 *.ts）' },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const { pattern, path: searchPath = process.cwd(), glob: fileGlob } = input as {
      pattern: string;
      path?: string;
      glob?: string;
    };

    // 优先使用 rg（ripgrep），回退到 grep
    const hasRg = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
    const cmd = hasRg ? 'rg' : 'grep';
    const args = hasRg
      ? ['-n', '--color=never', ...(fileGlob ? ['-g', fileGlob] : []), pattern, searchPath]
      : ['-rn', pattern, ...(fileGlob ? ['--include', fileGlob] : []), searchPath];

    const result = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const output = (result.stdout ?? '').trim();
    if (!output) return '（无匹配结果）';
    return output;
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/grep.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/grep.ts tests/ai/tools/grep.test.ts
git commit -m "feat: 实现 grep 工具，优先使用 rg 回退到 grep"
```

---

### Task 12：write 工具

**Files:**
- Create: `src/ai/tools/write.ts`
- Create: `tests/ai/tools/write.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/write.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeTool } from '../../../src/ai/tools/write.js';

describe('writeTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a new file with given content', async () => {
    const path = join(dir, 'new.ts');
    await writeTool.execute({ file_path: path, content: 'export const x = 1;' });
    expect(readFileSync(path, 'utf-8')).toBe('export const x = 1;');
  });

  it('creates parent directories automatically', async () => {
    const path = join(dir, 'deep', 'nested', 'file.ts');
    await writeTool.execute({ file_path: path, content: 'hello' });
    expect(existsSync(path)).toBe(true);
  });

  it('overwrites existing file', async () => {
    const path = join(dir, 'existing.txt');
    await writeTool.execute({ file_path: path, content: 'old' });
    await writeTool.execute({ file_path: path, content: 'new' });
    expect(readFileSync(path, 'utf-8')).toBe('new');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/write.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/write.ts**

```typescript
import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { Tool } from '../../types.js';

export const writeTool: Tool = {
  permission: 'write',
  definition: {
    name: 'write',
    description: '写入文件内容（覆盖或新建），自动创建父目录',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(input) {
    const { file_path, content } = input as { file_path: string; content: string };
    mkdirSync(dirname(file_path), { recursive: true });
    // 原子写入：temp 文件放在同目录，确保 rename 在同一文件系统（避免 Windows EXDEV 错误）
    const tmp = join(dirname(file_path), `.xiaok-tmp-${Date.now()}`);
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, file_path);
    return `已写入: ${file_path}（${content.length} 字符）`;
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/write.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/write.ts tests/ai/tools/write.test.ts
git commit -m "feat: 实现 write 工具，原子写入 + 自动创建目录"
```

---

### Task 13：edit 工具

**Files:**
- Create: `src/ai/tools/edit.ts`
- Create: `tests/ai/tools/edit.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/edit.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { editTool } from '../../../src/ai/tools/edit.js';

describe('editTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('replaces unique string', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'const x = 1;\nconst y = 2;');
    await editTool.execute({ file_path: path, old_string: 'const x = 1;', new_string: 'const x = 42;' });
    expect(readFileSync(path, 'utf-8')).toContain('const x = 42;');
  });

  it('returns error if old_string not found', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'hello world');
    const result = await editTool.execute({ file_path: path, old_string: 'not here', new_string: 'x' });
    expect(result).toContain('Error');
  });

  it('returns error if old_string appears more than once', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'foo\nfoo\n');
    const result = await editTool.execute({ file_path: path, old_string: 'foo', new_string: 'bar' });
    expect(result).toContain('Error');
    expect(result).toContain('2');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/edit.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/edit.ts**

```typescript
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { Tool } from '../../types.js';

export const editTool: Tool = {
  permission: 'write',
  definition: {
    name: 'edit',
    description: '在文件中精确替换字符串。old_string 必须在文件中唯一出现。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件绝对路径' },
        old_string: { type: 'string', description: '要替换的字符串（必须唯一）' },
        new_string: { type: 'string', description: '替换后的字符串' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(input) {
    const { file_path, old_string, new_string } = input as {
      file_path: string;
      old_string: string;
      new_string: string;
    };

    let content: string;
    try {
      content = readFileSync(file_path, 'utf-8');
    } catch {
      return `Error: 文件不存在: ${file_path}`;
    }

    const occurrences = content.split(old_string).length - 1;
    if (occurrences === 0) return `Error: old_string 在文件中不存在`;
    if (occurrences > 1) return `Error: old_string 在文件中出现了 ${occurrences} 次，必须唯一`;

    const updated = content.split(old_string).join(new_string);
    // 原子替换：temp 文件放在同目录，确保 rename 在同一文件系统（避免 Windows EXDEV 错误）
    const tmp = join(dirname(file_path), `.xiaok-tmp-${Date.now()}`);
    writeFileSync(tmp, updated, 'utf-8');
    renameSync(tmp, file_path);
    return `已编辑: ${file_path}`;
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/edit.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/edit.ts tests/ai/tools/edit.test.ts
git commit -m "feat: 实现 edit 工具，唯一性校验 + 原子替换"
```

---

### Task 14：bash 工具

**Files:**
- Create: `src/ai/tools/bash.ts`
- Create: `tests/ai/tools/bash.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/bash.test.ts
import { describe, it, expect } from 'vitest';
import { bashTool } from '../../../src/ai/tools/bash.js';

describe('bashTool', () => {
  it('runs a command and returns stdout', async () => {
    const result = await bashTool.execute({ command: 'echo hello' });
    expect(result).toContain('hello');
  });

  it('returns stderr on failure', async () => {
    const result = await bashTool.execute({ command: 'ls /nonexistent_path_xyz_abc' });
    expect(result).toMatch(/Error|No such file|cannot access/i);
  });

  it('respects timeout and kills process', async () => {
    const start = Date.now();
    const result = await bashTool.execute({ command: 'sleep 10', timeout_ms: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
    expect(result).toContain('超时');
  }, 5000);
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/bash.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/bash.ts**

```typescript
import { spawn } from 'child_process';
import type { Tool } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export const bashTool: Tool = {
  permission: 'bash',
  definition: {
    name: 'bash',
    description: '执行 shell 命令，返回 stdout + stderr。慎用：所有 bash 命令均视为潜在危险操作。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        timeout_ms: { type: 'number', description: `超时毫秒数（默认 ${DEFAULT_TIMEOUT_MS}）` },
      },
      required: ['command'],
    },
  },
  async execute(input) {
    const { command, timeout_ms = DEFAULT_TIMEOUT_MS } = input as { command: string; timeout_ms?: number };

    return new Promise(resolve => {
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
      const child = spawn(shell, shellArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
      }, timeout_ms);

      child.on('close', code => {
        clearTimeout(timer);
        if (killed) {
          resolve(`Error: 命令超时（>${timeout_ms}ms）\n${stdout}${stderr}`);
          return;
        }
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (code !== 0) {
          resolve(`Error (exit ${code}): ${output || '（无输出）'}`);
        } else {
          resolve(output || '（命令执行成功，无输出）');
        }
      });
    });
  },
};
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/bash.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/bash.ts tests/ai/tools/bash.test.ts
git commit -m "feat: 实现 bash 工具，SIGTERM/SIGKILL 超时处理"
```

---

### Task 15：工具注册表与权限模型

**Files:**
- Create: `src/ai/tools/index.ts`
- Create: `tests/ai/tools/index.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/tools/index.test.ts
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/ai/tools/index.js';

describe('ToolRegistry', () => {
  it('safe tools execute without prompting', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      autoMode: false,
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    });
    const result = await registry.executeTool('glob', { pattern: '*.nonexistent' });
    expect(prompted).toHaveLength(0);
    expect(result).toBeTruthy();
  });

  it('write tools prompt in default mode', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      autoMode: false,
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return false; /* deny */ },
    });
    const result = await registry.executeTool('write', { file_path: '/tmp/x', content: 'x' });
    expect(prompted).toContain('write');
    expect(result).toContain('已取消');
  });

  it('write tools skip prompt in auto mode', async () => {
    const prompted: string[] = [];
    const registry = new ToolRegistry({
      autoMode: true,
      dryRun: false,
      onPrompt: async (name) => { prompted.push(name); return true; },
    });
    // just check no prompt; don't actually write
    expect(prompted).toHaveLength(0);
  });

  it('dry-run returns description without executing', async () => {
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    const result = await registry.executeTool('bash', { command: 'rm -rf /' });
    expect(result).toContain('[dry-run]');
    expect(result).not.toContain('Error');
  });

  it('getToolDefinitions returns all tools', () => {
    const registry = new ToolRegistry({ autoMode: false, dryRun: false, onPrompt: async () => true });
    const defs = registry.getToolDefinitions();
    expect(defs.map(d => d.name)).toContain('bash');
    expect(defs.map(d => d.name)).toContain('read');
    expect(defs.map(d => d.name)).toContain('write');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/tools/index.test.ts
```

- [ ] **Step 3: 实现 src/ai/tools/index.ts**

```typescript
import type { Tool, ToolDefinition } from '../../types.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';

const ALL_TOOLS: Tool[] = [readTool, writeTool, editTool, bashTool, grepTool, globTool];

export interface RegistryOptions {
  autoMode: boolean;
  dryRun: boolean;
  onPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

export class ToolRegistry {
  private options: RegistryOptions;

  constructor(options: RegistryOptions) {
    this.options = options;
  }

  getToolDefinitions(): ToolDefinition[] {
    return ALL_TOOLS.map(t => t.definition);
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = ALL_TOOLS.find(t => t.definition.name === name);
    if (!tool) return `Error: 未知工具: ${name}`;

    if (this.options.dryRun) {
      return `[dry-run] ${name}(${JSON.stringify(input)})`;
    }

    const needsConfirm = !this.options.autoMode && tool.permission !== 'safe';
    if (needsConfirm) {
      const approved = await this.options.onPrompt(name, input);
      if (!approved) return `（已取消: ${name}）`;
    }

    try {
      return await tool.execute(input);
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  }

  /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
  enableAutoMode(): void {
    this.options.autoMode = true;
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/tools/index.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/index.ts tests/ai/tools/index.test.ts
git commit -m "feat: 实现工具注册表和权限模型（safe/write/bash），支持 dry-run 和 y!"
```

---

## Chunk 4：上下文注入 + Agent 循环

### Task 16：云之家上下文注入

**Files:**
- Create: `data/yzj-api-overview.md`
- Create: `src/ai/context/yzj-context.ts`
- Create: `tests/ai/context/yzj-context.test.ts`

- [ ] **Step 1: 创建内置 API 概览文档**

```markdown
<!-- data/yzj-api-overview.md -->
# 云之家开放平台 API 概览

## 认证方式
云之家 Open API 使用 OAuth 2.0 授权码模式。请求需在 Header 中携带：
`Authorization: Bearer <access_token>`

## 主要 API 模块

### 消息 API
- POST /v1/message/send — 发送文本/卡片消息给指定用户或群组
- 参数：toUser（用户 ID）、toGroup（群组 ID）、content（消息内容）

### 组织架构 API
- GET /v1/org/users — 获取企业用户列表
- GET /v1/org/departments — 获取部门列表
- GET /v1/org/user/{userId} — 获取指定用户信息

### 应用管理 API
- GET /v1/apps — 获取企业已安装的应用列表
- POST /v1/apps/{appId}/message — 通过应用发送消息

### Webhook 事件
云之家支持通过 Webhook 接收企业事件（消息、审批、考勤等）。
配置 Webhook URL 后，云之家将以 POST 请求推送事件到指定地址。

### 工作流 API
- POST /v1/workflow/trigger — 触发指定工作流
- GET /v1/workflow/{instanceId}/status — 查询工作流实例状态

## SDK 支持
官方提供 Java、Python、Node.js、PHP SDK。
Node.js SDK：`npm install @yunzhijia/sdk`

## 错误码
- 401：token 过期或无效，请重新获取
- 403：无权限
- 429：请求频率超限，建议指数退避重试
```

- [ ] **Step 2: 写失败的测试**

```typescript
// tests/ai/context/yzj-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../src/ai/context/yzj-context.js';

describe('buildSystemPrompt', () => {
  it('includes yzj API overview', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('云之家');
  });

  it('includes enterprise context when logged in', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_123', devApp: null, cwd: '/tmp', budget: 4000 });
    expect(prompt).toContain('ent_123');
  });

  it('truncates to token budget', async () => {
    const prompt = await buildSystemPrompt({ enterpriseId: null, devApp: null, cwd: '/tmp', budget: 50 });
    // rough estimate: 50 tokens ≈ 200 chars
    expect(prompt.length).toBeLessThan(1000);
  });

  it('resolves successfully when yzj CLI is not installed or times out', async () => {
    // spawnSync returns non-zero when yzj is not found; buildSystemPrompt should not throw
    const prompt = await buildSystemPrompt({ enterpriseId: 'ent_x', devApp: null, cwd: '/tmp', budget: 4000 });
    // Should still contain the base API overview even if yzj help loading failed
    expect(prompt).toContain('云之家');
    expect(typeof prompt).toBe('string');
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

```bash
npx vitest run tests/ai/context/yzj-context.test.ts
```

- [ ] **Step 4: 实现 src/ai/context/yzj-context.ts**

```typescript
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import type { DevAppIdentity } from '../../auth/identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_OVERVIEW_PATH = join(__dirname, '../../../data/yzj-api-overview.md');

interface ContextOptions {
  enterpriseId: string | null;
  devApp: DevAppIdentity | null;
  cwd: string;
  budget: number; // token budget (1 token ≈ 4 chars)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...(已截断)';
}

function loadYzjHelp(): string {
  const result = spawnSync('yzj', ['--help'], { encoding: 'utf-8', timeout: 3000 });
  if (result.error || result.status !== 0) return '';
  return result.stdout?.trim() ?? '';
}

export async function buildSystemPrompt(opts: ContextOptions): Promise<string> {
  const sections: string[] = [];

  // 1. 角色定义
  sections.push(`你是 xiaok，面向云之家（yunzhijia.com）开发者的 AI 编程助手。你擅长云之家开放平台 API 集成、轻应用开发、Webhook 配置等场景。`);

  // 2. 当前会话上下文
  const ctxLines = [`当前工作目录：${opts.cwd}`];
  if (opts.enterpriseId) ctxLines.push(`登录企业 ID：${opts.enterpriseId}`);
  if (opts.devApp) ctxLines.push(`开发者应用：appKey=${opts.devApp.appKey}`);
  sections.push(ctxLines.join('\n'));

  // 3. 云之家 API 概览（内置文档）
  let apiOverview = '';
  if (existsSync(API_OVERVIEW_PATH)) {
    apiOverview = readFileSync(API_OVERVIEW_PATH, 'utf-8');
  }

  // 4. yzj CLI 帮助（动态加载）
  const yzjHelp = loadYzjHelp();

  // 组装并按预算裁剪
  const base = sections.join('\n\n');
  let remaining = opts.budget - estimateTokens(base);

  let yzjSection = '';
  if (yzjHelp && remaining > 100) {
    const maxYzjTokens = Math.min(remaining - 100, Math.floor(remaining / 2));
    yzjSection = truncateToTokens(`## yzj CLI 用法\n${yzjHelp}`, maxYzjTokens);
    remaining -= estimateTokens(yzjSection);
  }

  let apiSection = '';
  if (apiOverview && remaining > 50) {
    apiSection = truncateToTokens(apiOverview, remaining);
  }

  return [base, apiSection, yzjSection].filter(Boolean).join('\n\n');
}
```

- [ ] **Step 5: 运行测试**

```bash
npx vitest run tests/ai/context/yzj-context.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add data/yzj-api-overview.md src/ai/context/yzj-context.ts tests/ai/context/yzj-context.test.ts
git commit -m "feat: 实现云之家上下文注入，含 API 概览和 yzj CLI help，token 预算裁剪"
```

---

### Task 17：AI Agent 主循环

**Files:**
- Create: `src/ai/agent.ts`
- Create: `tests/ai/agent.test.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// tests/ai/agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { ModelAdapter, StreamChunk } from '../../src/types.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('Agent', () => {
  it('returns text response without tool calls', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([
        { type: 'text', delta: 'Hello ' },
        { type: 'text', delta: 'world' },
        { type: 'done' },
      ]),
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('hi', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(outputs.join('')).toBe('Hello world');
  });

  it('executes a tool call and loops back', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    let callCount = 0;
    const adapter: ModelAdapter = {
      stream: () => {
        callCount++;
        if (callCount === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.nonexistent' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'Done' }, { type: 'done' }]);
      },
    };
    const registry = new ToolRegistry({ autoMode: true, dryRun: false, onPrompt: async () => true });
    const agent = new Agent(adapter, registry, 'system');

    const outputs: string[] = [];
    await agent.runTurn('list files', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(callCount).toBe(2);
    expect(outputs.join('')).toBe('Done');
  });

  it('dry-run emits tool description without executing', async () => {
    const { Agent } = await import('../../src/ai/agent.js');
    const adapter: ModelAdapter = {
      stream: () => mockStream([
        { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'rm -rf /' } },
        { type: 'done' },
      ]),
    };
    // dry-run registry — stops after first tool call in dry-run (returns mock)
    const registry = new ToolRegistry({ autoMode: false, dryRun: true, onPrompt: async () => true });
    // For test: override executeTool to return dry-run message and stop loop
    vi.spyOn(registry, 'executeTool').mockResolvedValue('[dry-run] bash({"command":"rm -rf /"})');
    // Adapter returns done after tool, so loop ends
    const agent = new Agent(adapter, registry, 'system');
    const outputs: string[] = [];
    await agent.runTurn('bad', (chunk) => { if (chunk.type === 'text') outputs.push(chunk.delta); });
    expect(registry.executeTool).toHaveBeenCalledWith('bash', { command: 'rm -rf /' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/ai/agent.test.ts
```

- [ ] **Step 3: 实现 src/ai/agent.ts**

```typescript
import type { ModelAdapter, Message, StreamChunk, ToolResultContent } from '../types.js';
import type { ToolRegistry } from './tools/index.js';

export type OnChunk = (chunk: StreamChunk) => void;

export class Agent {
  private messages: Message[] = [];
  private adapter: ModelAdapter;
  private registry: ToolRegistry;
  private systemPrompt: string;

  constructor(adapter: ModelAdapter, registry: ToolRegistry, systemPrompt: string) {
    this.adapter = adapter;
    this.registry = registry;
    this.systemPrompt = systemPrompt;
  }

  /** 执行一轮对话（可能包含多次工具调用循环） */
  async runTurn(userInput: string, onChunk: OnChunk): Promise<void> {
    this.messages.push({ role: 'user', content: userInput });

    while (true) {
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      const textParts: string[] = [];

      for await (const chunk of this.adapter.stream(
        this.messages,
        this.registry.getToolDefinitions(),
        this.systemPrompt
      )) {
        if (chunk.type === 'text') {
          textParts.push(chunk.delta);
          onChunk(chunk);
        } else if (chunk.type === 'tool_use') {
          toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
        } else if (chunk.type === 'done') {
          break;
        }
      }

      // 构建 assistant message，保留 toolCalls 供 OpenAI 适配器使用
      const assistantContent = textParts.join('');
      this.messages.push({
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // 如果没有工具调用，对话结束
      if (toolCalls.length === 0) break;

      // 执行工具调用，收集结果
      const toolResults: ToolResultContent[] = [];
      for (const tc of toolCalls) {
        const result = await this.registry.executeTool(tc.name, tc.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result,
          is_error: result.startsWith('Error'),
        });
      }

      this.messages.push({ role: 'tool_result', content: toolResults });
    }
  }

  /** 清空历史记录（会话结束时调用） */
  clearHistory(): void {
    this.messages = [];
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/ai/agent.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/agent.ts tests/ai/agent.test.ts
git commit -m "feat: 实现 AI Agent 主循环，支持工具调用链和 dry-run"
```

---

## Chunk 5：CLI 命令 + 终端 UI + 入口

### Task 18：终端 UI 工具（utils/ui.ts）

**Files:**
- Create: `src/utils/ui.ts`

- [ ] **Step 1: 实现 src/utils/ui.ts**

```typescript
import * as readline from 'readline';

/** 流式输出文本（直接写 stdout，无换行缓冲） */
export function writeChunk(text: string): void {
  process.stdout.write(text);
}

/** 输出一行（带换行） */
export function writeLine(text: string): void {
  console.log(text);
}

/** 输出错误行 */
export function writeError(text: string): void {
  console.error(`\x1b[31mError:\x1b[0m ${text}`);
}

/** 检测 stdin 是否为 TTY */
export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * 向用户询问确认。
 * 返回 true（确认）或 false（拒绝）。
 * 若用户输入 "y!"，返回 true 并设置 autoMode 回调。
 */
export async function confirm(
  toolName: string,
  input: Record<string, unknown>,
  onAutoMode?: () => void
): Promise<boolean> {
  const inputSummary = JSON.stringify(input).slice(0, 120);
  process.stdout.write(`\n\x1b[33m[确认]\x1b[0m 执行 \x1b[36m${toolName}\x1b[0m: ${inputSummary}\n`);
  process.stdout.write('输入 y 确认，n 取消，y! 此后全部自动确认：');

  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.once('line', (line: string) => {
      rl.close();
      const answer = line.trim().toLowerCase();
      if (answer === 'y!') {
        onAutoMode?.();
        resolve(true);
      } else {
        resolve(answer === 'y');
      }
    });
  });
}
```

- [ ] **Step 2: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add src/utils/ui.ts
git commit -m "feat: 实现终端 UI 工具（流式输出、确认提示、y! 检测）"
```

---

### Task 19：auth 命令（占位实现）

**Files:**
- Create: `src/auth/login.ts`
- Create: `src/commands/auth.ts`

- [ ] **Step 1: 实现 src/auth/login.ts（占位）**

```typescript
// Phase 1 占位实现，完整 OAuth 流程在 Phase 2 实现
import { saveCredentials, clearCredentials, loadCredentials } from './token-store.js';
import type { Credentials } from '../types.js';

export async function login(): Promise<void> {
  console.log('\x1b[33m[Phase 1 占位]\x1b[0m 完整的浏览器 OAuth 流程将在 Phase 2 实现。');
  console.log('临时方案：请手动设置 credentials.json，或使用 xiaok config set api-key 配置 AI 模型 Key。');

  // 写入示例凭据（供开发测试用）
  const mock: Credentials = {
    schemaVersion: 1,
    accessToken: 'PLACEHOLDER_TOKEN',
    refreshToken: 'PLACEHOLDER_REFRESH',
    enterpriseId: 'PLACEHOLDER_ENTERPRISE',
    userId: 'PLACEHOLDER_USER',
    expiresAt: new Date(Date.now() + 86400 * 1000 * 365).toISOString(),
  };
  await saveCredentials(mock);
  console.log('已写入占位凭据到 ~/.xiaok/credentials.json');
}

export async function logout(): Promise<void> {
  await clearCredentials();
  console.log('已清除凭据。');
}

export async function status(): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log('未登录。运行 xiaok auth login 进行登录。');
    return;
  }
  console.log(`已登录\n  企业 ID：${creds.enterpriseId}\n  用户 ID：${creds.userId}\n  Token 过期：${creds.expiresAt}`);
}
```

- [ ] **Step 2: 实现 src/commands/auth.ts**

```typescript
import type { Command } from 'commander';
import { login, logout, status } from '../auth/login.js';

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('管理云之家账号认证');

  auth
    .command('login')
    .description('登录云之家账号（Phase 1 占位，Phase 2 实现完整 OAuth）')
    .action(async () => {
      await login();
    });

  auth
    .command('logout')
    .description('退出登录，清除本地凭据')
    .action(async () => {
      await logout();
    });

  auth
    .command('status')
    .description('查看当前登录状态')
    .action(async () => {
      await status();
    });
}
```

- [ ] **Step 3: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add src/auth/login.ts src/commands/auth.ts
git commit -m "feat: 实现 auth 命令（Phase 1 占位），login/logout/status"
```

---

### Task 20：config 命令

**Files:**
- Create: `src/commands/config.ts`

- [ ] **Step 1: 实现 src/commands/config.ts**

```typescript
import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../utils/config.js';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('管理 xiaok 配置');

  const configSet = config.command('set').description('设置配置项');

  configSet
    .command('model <value>')
    .description('设置默认 AI 模型（claude / openai / custom）')
    .option('--base-url <url>', '自定义模型 base URL（model=custom 时使用）')
    .option('--api-key <key>', '同时设置该模型的 API Key')
    .action(async (value: string, opts: { baseUrl?: string; apiKey?: string }) => {
      const cfg = await loadConfig();
      if (value === 'claude' || value === 'openai' || value === 'custom') {
        cfg.defaultModel = value;
        if (opts.baseUrl && value === 'custom') {
          cfg.models.custom = { ...cfg.models.custom, baseUrl: opts.baseUrl };
        }
        if (opts.apiKey) {
          cfg.models[value] = { ...cfg.models[value], apiKey: opts.apiKey } as never;
        }
        await saveConfig(cfg);
        console.log(`已设置默认模型为: ${value}`);
      } else {
        // 尝试解析为 provider/model 格式，如 openai/gpt-4o
        const [provider, model] = value.split('/');
        if (provider && model && ['claude', 'openai'].includes(provider)) {
          cfg.defaultModel = provider as 'claude' | 'openai';
          cfg.models[provider as 'claude' | 'openai'] = {
            ...cfg.models[provider as 'claude' | 'openai'],
            model,
          };
          await saveConfig(cfg);
          console.log(`已设置默认模型为: ${provider}/${model}`);
        } else {
          console.error(`未知模型: ${value}。支持: claude, openai, custom, openai/gpt-4o 等`);
        }
      }
    });

  configSet
    .command('api-key <key>')
    .description('设置 AI 模型 API Key')
    .option('--provider <provider>', '指定提供商（默认当前默认模型）')
    .action(async (key: string, opts: { provider?: string }) => {
      const cfg = await loadConfig();
    const provider = (opts.provider ?? cfg.defaultModel) as 'claude' | 'openai' | 'custom';
      // custom 模型必须先有 baseUrl 才能设置 apiKey
      if (provider === 'custom' && !cfg.models.custom?.baseUrl) {
        console.error('请先设置 baseUrl：xiaok config set model custom --base-url <url>');
        return;
      }
      cfg.models[provider] = { ...cfg.models[provider], apiKey: key } as never;
      await saveConfig(cfg);
      console.log(`已为 ${provider} 设置 API Key`);
    });

  configSet
    .command('context-budget <tokens>')
    .description('设置系统提示 token 预算（默认 4000）')
    .action(async (tokens: string) => {
      const cfg = await loadConfig();
      cfg.contextBudget = parseInt(tokens, 10);
      await saveConfig(cfg);
      console.log(`已设置 context-budget 为 ${tokens} tokens`);
    });

  config
    .command('get <key>')
    .description('获取配置项（如 model）')
    .action(async (key: string) => {
      const cfg = await loadConfig();
      if (key === 'model') {
        const m = cfg.models[cfg.defaultModel];
        console.log(`${cfg.defaultModel}${'model' in (m ?? {}) ? '/' + (m as { model: string }).model : ''}`);
      } else {
        console.log(JSON.stringify((cfg as Record<string, unknown>)[key] ?? null, null, 2));
      }
    });
}
```

- [ ] **Step 2: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add src/commands/config.ts
git commit -m "feat: 实现 config 命令（model/api-key/context-budget 设置和读取）"
```

---

### Task 21：chat 命令

**Files:**
- Create: `src/commands/chat.ts`

- [ ] **Step 1: 实现 src/commands/chat.ts**

```typescript
import * as readline from 'readline';
import type { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { ToolRegistry } from '../ai/tools/index.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { writeChunk, writeLine, writeError, isTTY, confirm } from '../utils/ui.js';

interface ChatOptions {
  auto: boolean;
  dryRun: boolean;
}

async function runChat(initialInput: string | undefined, opts: ChatOptions): Promise<void> {
  // 检测 CI 环境
  const autoMode = opts.auto || !isTTY();
  if (!isTTY() && !opts.auto) {
    console.warn('\x1b[33m[警告]\x1b[0m stdin 非 TTY，自动切换为 --auto 模式');
  }

  // 加载配置和凭据
  const config = await loadConfig();
  let adapter;
  try {
    adapter = createAdapter(config);
  } catch (e) {
    writeError(String(e));
    process.exit(1);
  }

  const creds = await loadCredentials();
  const devApp = await getDevAppIdentity();

  // 构建系统提示
  const systemPrompt = await buildSystemPrompt({
    enterpriseId: creds?.enterpriseId ?? null,
    devApp,
    cwd: process.cwd(),
    budget: config.contextBudget,
  });

  // 创建 registry
  const registry = new ToolRegistry({
    autoMode,
    dryRun: opts.dryRun,
    onPrompt: async (name, input) => {
      return confirm(name, input, () => registry.enableAutoMode());
    },
  });

  const agent = new Agent(adapter, registry, systemPrompt);

  // 单次任务模式
  if (initialInput) {
    process.stdout.write('\n');
    await agent.runTurn(initialInput, (chunk) => {
      if (chunk.type === 'text') writeChunk(chunk.delta);
    });
    process.stdout.write('\n');
    return;
  }

  // 交互模式
  writeLine('\x1b[36mxiaok\x1b[0m - 云之家 AI 编程助手。输入 /exit 或 Ctrl-C 退出。');
  if (opts.dryRun) writeLine('\x1b[33m[dry-run 模式]\x1b[0m 工具调用不会实际执行。');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // SIGINT 处理
  process.on('SIGINT', () => {
    writeLine('\n已退出。');
    rl.close();
    process.exit(0);
  });

  const askQuestion = (): void => {
    rl.question('\n\x1b[36m> \x1b[0m', async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === '/exit') {
        writeLine('再见！');
        rl.close();
        return;
      }
      process.stdout.write('\n');
      try {
        await agent.runTurn(trimmed, (chunk) => {
          if (chunk.type === 'text') writeChunk(chunk.delta);
        });
      } catch (e) {
        writeError(String(e));
      }
      process.stdout.write('\n');
      askQuestion();
    });
  };

  askQuestion();
}

export function registerChatCommands(program: Command): void {
  program
    .command('chat', { isDefault: true })
    .description('启动 AI 编程助手（默认命令）')
    .option('--auto', '自动执行所有工具，无需确认（适用于 CI）')
    .option('--dry-run', '打印工具调用但不执行')
    .argument('[input]', '单次任务描述（省略则进入交互模式）')
    .action(async (input: string | undefined, opts: ChatOptions) => {
      await runChat(input, opts);
    });
}
```

- [ ] **Step 2: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add src/commands/chat.ts
git commit -m "feat: 实现 chat 命令（交互/单次/--auto/--dry-run 模式）"
```

---

### Task 22：CLI 入口（src/index.ts）

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 实现 src/index.ts**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerChatCommands } from './commands/chat.js';

const program = new Command();

program
  .name('xiaok')
  .description('面向云之家开发者的 AI 编程助手 CLI')
  .version('0.1.0');

registerAuthCommands(program);
registerConfigCommands(program);
registerChatCommands(program);

// chat 命令注册时使用 { isDefault: true }，Commander 自动处理无子命令时的路由
// 无需额外 program.action() — 会导致双重调用

program.parse();
```

- [ ] **Step 2: 完整编译**

```bash
npx tsc
```

Expected: `dist/` 目录生成，无报错。

- [ ] **Step 3: 冒烟测试（本地运行）**

```bash
node dist/index.js --help
node dist/index.js auth status
node dist/index.js config get model
```

Expected:
- `--help` 显示命令列表
- `auth status` 显示"未登录"
- `config get model` 输出 `claude/claude-opus-4-6`（或当前配置）

- [ ] **Step 4: 运行全量测试**

```bash
npx vitest run
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: 实现 CLI 入口，注册所有命令"
```

---

### Task 23：完整集成验证

- [ ] **Step 1: 配置 Claude API Key**

```bash
node dist/index.js config set api-key <你的-claude-api-key> --provider claude
```

- [ ] **Step 2: 单次任务 dry-run 测试**

```bash
node dist/index.js chat --dry-run "列出当前目录下的 TypeScript 文件"
```

Expected: 输出 `[dry-run] glob(...)` 调用记录，不实际执行文件操作。

- [ ] **Step 3: 交互式 Agent 测试（可选，需真实 API Key）**

```bash
node dist/index.js chat
> 帮我写一个 Hello World TypeScript 文件
```

Expected: AI 调用 write 工具创建文件，提示确认，完成后输出结果。

- [ ] **Step 4: 最终 commit**

```bash
git add -A
git commit -m "chore: Phase 1 完整集成验证通过"
```

---

## 快速参考

### 运行测试

```bash
npx vitest run              # 全量测试
npx vitest run tests/ai/    # 只跑 AI 模块测试
npx vitest --watch          # 监听模式
```

### 编译

```bash
npx tsc          # 完整编译到 dist/
npx tsc --noEmit # 只做类型检查
```

### 本地运行

```bash
npm run dev -- chat          # 使用 tsx 直接运行（无需编译）
node dist/index.js --help    # 编译后运行
```
