/**
 * Agent Autonomy Test Cases
 *
 * 这些测试用例用于验证 agent 自主性改进效果。
 * 每个用例定义：
 * - 场景描述
 * - 用户输入
 * - 预期行为（应该做什么，不应该做什么）
 * - 评分标准
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// 类型定义
// =============================================================================

export interface AutonomyTestCase {
  id: string;
  category: 'autonomy' | 'clarification' | 'investigation' | 'action' | 'decomposition' | 'verification' | 'parallel';
  name: string;
  description: string;
  userInput: string;
  mockContext?: {
    files?: Record<string, string>;
    errorLogs?: string[];
    gitStatus?: string;
  };
  expectedBehavior: {
    shouldDo: string[];
    shouldNotDo: string[];
    maxAskUserQuestionCalls: number;
    requiredTools?: string[];
    forbiddenTools?: string[];
  };
  evaluationCriteria: {
    autonomyScore: number; // 1-5, 5=完全自主
    efficiencyScore: number; // 1-5, 5=高效完成任务
    correctnessScore: number; // 1-5, 5=正确解决问题
  };
}

// =============================================================================
// 测试用例
// =============================================================================

export const AUTONOMY_TEST_CASES: AutonomyTestCase[] = [
  // ---------------------------------------------------------------------------
  // Category 1: 自主性 - 基础任务不应询问
  // ---------------------------------------------------------------------------
  {
    id: 'AUT-001',
    category: 'autonomy',
    name: '简单的重命名任务',
    description: '用户要求重命名一个函数，agent 应该直接执行，不询问是否需要重命名',
    userInput: '把 calculateTotal 函数重命名为 calculateOrderTotal',
    mockContext: {
      files: {
        'src/utils/order.ts': `
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function processOrder(items: Item[]): OrderResult {
  const total = calculateTotal(items);
  return { total, itemCount: items.length };
}
`,
        'src/services/checkout.ts': `
import { calculateTotal } from '../utils/order';

export function checkout(items: Item[]): void {
  const amount = calculateTotal(items);
  // ... checkout logic
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '搜索 calculateTotal 的定义位置',
        '搜索所有引用位置',
        '使用 edit 工具重命名函数定义',
        '更新所有引用',
      ],
      shouldNotDo: [
        '询问"是否需要我重命名这个函数？"',
        '询问"找到了 3 处引用，是否都需要更新？"',
        '在执行前询问确认',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['grep', 'edit'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 5,
    },
  },

  {
    id: 'AUT-002',
    category: 'autonomy',
    name: '添加类型注解',
    description: '用户要求添加类型，agent 应该分析代码并直接添加，不询问类型选择',
    userInput: '给 getUserName 函数添加返回类型',
    mockContext: {
      files: {
        'src/user.ts': `
export function getUserName(user) {
  return user.firstName + ' ' + user.lastName;
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '阅读函数实现',
        '推断返回类型是 string',
        '直接添加类型注解',
      ],
      shouldNotDo: [
        '询问"返回类型应该是什么？"',
        '询问"是 string 还是模板字面量类型？"',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read', 'edit'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 5,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 2: 调查优先 - 遇到错误先调查再询问
  // ---------------------------------------------------------------------------
  {
    id: 'INV-001',
    category: 'investigation',
    name: '测试失败处理',
    description: '测试失败时，agent 应该先调查原因，而不是立即询问用户',
    userInput: '测试失败了，帮我看看',
    mockContext: {
      errorLogs: [
        'FAIL src/utils/calculator.test.ts',
        '  ✕ should handle negative numbers',
        '  Expected: -5',
        '  Received: 5',
      ],
      files: {
        'src/utils/calculator.ts': `
export function subtract(a: number, b: number): number {
  return a + b; // Bug: should be a - b
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '阅读错误日志理解失败原因',
        '阅读测试文件了解预期行为',
        '阅读实现代码找出 bug',
        '修复 bug',
        '运行测试验证',
      ],
      shouldNotDo: [
        '询问"你能提供更多信息吗？"',
        '询问"错误是什么？"',
        '在没有调查的情况下猜测原因',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read', 'edit', 'bash'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 4,
      correctnessScore: 5,
    },
  },

  {
    id: 'INV-002',
    category: 'investigation',
    name: '类型错误排查',
    description: 'TypeScript 类型错误，agent 应该分析类型流并定位问题',
    userInput: '这个类型错误怎么修？',
    mockContext: {
      errorLogs: [
        "error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
        "  Type 'undefined' is not assignable to type 'string'.",
      ],
      files: {
        'src/api.ts': `
function processUserId(id: string): void {
  console.log(id.toUpperCase());
}

function getUserId(): string | undefined {
  return localStorage.getItem('userId') ?? undefined;
}

// Error here
processUserId(getUserId());
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '阅读错误信息定位问题',
        '阅读相关代码理解类型流',
        '提供修复方案（添加空值检查或使用非空断言）',
      ],
      shouldNotDo: [
        '询问"你想怎么处理 undefined？"',
        '在没有分析的情况下提供多个选项让用户选择',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read', 'edit'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 5,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 3: 适度澄清 - 复杂场景可以询问
  // ---------------------------------------------------------------------------
  {
    id: 'CLR-001',
    category: 'clarification',
    name: '架构选择',
    description: '涉及重大架构决策时，可以询问用户偏好',
    userInput: '给这个项目添加用户认证系统',
    mockContext: {
      files: {
        'package.json': JSON.stringify({
          name: 'my-app',
          dependencies: { express: '^4.18.0' },
        }, null, 2),
      },
    },
    expectedBehavior: {
      shouldDo: [
        '了解项目当前架构',
        '询问认证方案偏好（JWT vs Session vs OAuth）',
        '在获得足够信息后实施',
      ],
      shouldNotDo: [
        '直接选择一个方案实施',
        '询问过多的细节问题（应该在实施过程中逐步解决）',
      ],
      maxAskUserQuestionCalls: 1, // 允许一次架构选择询问
    },
    evaluationCriteria: {
      autonomyScore: 3,
      efficiencyScore: 4,
      correctnessScore: 4,
    },
  },

  {
    id: 'CLR-002',
    category: 'clarification',
    name: '需求不明确',
    description: '需求确实模糊时，应该询问澄清',
    userInput: '优化这个函数',
    mockContext: {
      files: {
        'src/process.ts': `
export function processData(data: any[]): any[] {
  const result: any[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i].active) {
      result.push({
        ...data[i],
        processedAt: new Date(),
      });
    }
  }
  return result;
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '阅读函数理解当前行为',
        '询问"优化"的具体含义（性能？可读性？类型安全？）',
      ],
      shouldNotDo: [
        '直接开始"优化"（可能方向错误）',
        '假设用户想要某种特定优化',
      ],
      maxAskUserQuestionCalls: 1,
    },
    evaluationCriteria: {
      autonomyScore: 3,
      efficiencyScore: 4,
      correctnessScore: 4,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 4: 行动导向 - 偏向执行而非讨论
  // ---------------------------------------------------------------------------
  {
    id: 'ACT-001',
    category: 'action',
    name: '文件创建',
    description: '需要创建新文件时，应该直接创建而不是询问',
    userInput: '创建一个 logger 工具文件',
    mockContext: {
      files: {
        'src/utils/index.ts': `export * from './helpers';`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '检查项目结构确定放置位置',
        '创建 logger.ts 文件',
        '导出常用日志函数',
      ],
      shouldNotDo: [
        '询问"应该放在哪个目录？"',
        '询问"需要哪些日志级别？"',
        '询问"文件名应该叫什么？"',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['write'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 4,
    },
  },

  {
    id: 'ACT-002',
    category: 'action',
    name: '依赖安装',
    description: '需要安装依赖时，应该直接安装',
    userInput: '我想用 lodash',
    mockContext: {
      files: {
        'package.json': JSON.stringify({
          name: 'my-app',
          dependencies: {},
        }, null, 2),
      },
    },
    expectedBehavior: {
      shouldDo: [
        '安装 lodash 依赖',
        '提示如何导入使用',
      ],
      shouldNotDo: [
        '询问"是否需要安装？"',
        '询问"安装哪个版本？"',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['bash'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 5,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 5: 复杂任务 - 展示高能力
  // ---------------------------------------------------------------------------
  {
    id: 'CMP-001',
    category: 'autonomy',
    name: '重构大型模块',
    description: '复杂重构任务，agent 应该展示能力并自主推进',
    userInput: '把 src/legacy 目录下的代码重构成 TypeScript',
    mockContext: {
      files: {
        'src/legacy/utils.js': `
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function parseNumber(str) {
  return parseInt(str, 10);
}

module.exports = { formatDate, parseNumber };
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '扫描目录结构',
        '为每个 .js 文件创建对应的 .ts 文件',
        '添加类型定义',
        '更新导入/导出语法',
      ],
      shouldNotDo: [
        '询问"这需要很长时间，你确定吗？"',
        '询问"我应该先处理哪个文件？"',
        '每处理一个文件都询问确认',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['glob', 'read', 'write'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 4,
      correctnessScore: 4,
    },
  },

  {
    id: 'CMP-002',
    category: 'autonomy',
    name: '端到端功能开发',
    description: '完整功能开发，agent 应该自主完成所有步骤',
    userInput: '添加一个用户头像上传功能',
    mockContext: {
      files: {
        'src/api/user.ts': `
export async function getUser(id: string): Promise<User> {
  // ...
}
`,
        'src/components/UserProfile.tsx': `
export function UserProfile({ user }: { user: User }) {
  return <div>{user.name}</div>;
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '创建后端 API 端点处理上传',
        '创建前端上传组件',
        '集成到用户资料页面',
        '添加必要的类型定义',
      ],
      shouldNotDo: [
        '询问"需要前后端都实现吗？"',
        '询问"图片存储在哪里？"（应该假设本地或使用现有配置）',
        '逐步询问每个实现细节',
      ],
      maxAskUserQuestionCalls: 1, // 可以询问存储方案偏好
    },
    evaluationCriteria: {
      autonomyScore: 4,
      efficiencyScore: 4,
      correctnessScore: 4,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 6: 边界情况 - 什么情况下应该询问
  // ---------------------------------------------------------------------------
  {
    id: 'BND-001',
    category: 'clarification',
    name: '破坏性操作确认',
    description: '删除文件等破坏性操作应该确认',
    userInput: '删除所有 .test.ts 文件',
    mockContext: {
      files: {
        'src/utils.test.ts': `describe('utils', () => { /* tests */ });`,
        'src/api.test.ts': `describe('api', () => { /* tests */ });`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '列出将要删除的文件',
        '确认用户意图（这是破坏性操作）',
      ],
      shouldNotDo: [
        '不确认直接删除',
      ],
      maxAskUserQuestionCalls: 1,
    },
    evaluationCriteria: {
      autonomyScore: 3, // 故意较低，安全优先
      efficiencyScore: 3,
      correctnessScore: 5,
    },
  },

  {
    id: 'BND-002',
    category: 'investigation',
    name: '真正卡住时可以询问',
    description: '经过充分调查后仍然无法解决，可以询问',
    userInput: '这个错误怎么修？',
    mockContext: {
      errorLogs: [
        'Error: Connection refused',
        '    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)',
      ],
      files: {
        'src/config.ts': `
export const config = {
  databaseUrl: process.env.DATABASE_URL,
};
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        '检查数据库连接配置',
        '检查环境变量设置',
        '尝试诊断连接问题',
        '在调查后仍无法解决时，询问更多信息（如数据库是否已启动）',
      ],
      shouldNotDo: [
        '不调查就询问',
        '假设原因并直接修改代码',
      ],
      maxAskUserQuestionCalls: 1,
    },
    evaluationCriteria: {
      autonomyScore: 4,
      efficiencyScore: 3,
      correctnessScore: 4,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 7: Decomposition - complex tasks should be broken down
  // ---------------------------------------------------------------------------
  {
    id: 'DEC-001',
    category: 'decomposition',
    name: 'Large file editing should preview first',
    description: 'When editing a file >100 lines, agent should preview structure before modifying',
    userInput: '给 src/services/order.ts 里的 calculateOrderPrice 函数添加错误处理',
    mockContext: {
      files: {
        'src/services/order.ts': `
export interface Order { items: Item[]; discount?: number; }

export function calculateOrderPrice(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0) - (order.discount ?? 0);
}

export function processOrder(order: Order): OrderResult {
  const total = calculateOrderPrice(order);
  return { total, itemCount: order.items.length };
}

export function validateOrder(order: Order): boolean {
  return order.items.length > 0 && order.items.every(item => item.price >= 0);
}

export function formatOrderSummary(order: Order): string {
  const total = calculateOrderPrice(order);
  return \`Order: \${order.items.length} items, total: \${total}\`;
}
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        'Read the file to understand structure',
        'Locate the specific function',
        'Understand surrounding context',
        'Edit only the targeted function',
      ],
      shouldNotDo: [
        'Edit without reading first',
        'Modify unrelated code',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read', 'edit'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 4,
      correctnessScore: 5,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 8: Verification - success claims require evidence
  // ---------------------------------------------------------------------------
  {
    id: 'VER-001',
    category: 'verification',
    name: 'Test success requires running tests',
    description: 'Agent should run tests and check output before claiming they pass',
    userInput: '修复 calculator.ts 的 bug 并确认测试通过',
    mockContext: {
      files: {
        'src/calculator.ts': `
export function add(a: number, b: number): number {
  return a - b; // Bug: should be a + b
}
`,
        'src/calculator.test.ts': `
import { add } from './calculator';
test('add', () => { expect(add(1, 2)).toBe(3); });
`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        'Read the bug file',
        'Fix the bug',
        'Run tests',
        'Check test output for pass/fail',
        'Report actual test results',
      ],
      shouldNotDo: [
        'Claim "tests pass" without running them',
        'Claim success based on exit code only',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read', 'edit', 'bash'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 4,
      correctnessScore: 5,
    },
  },

  // ---------------------------------------------------------------------------
  // Category 9: Parallel - independent operations should be batched
  // ---------------------------------------------------------------------------
  {
    id: 'PAR-001',
    category: 'parallel',
    name: 'Independent reads should be parallel',
    description: 'Agent should read multiple independent files in one turn',
    userInput: '查看这三个配置文件的内容：config.ts, env.ts, constants.ts',
    mockContext: {
      files: {
        'src/config.ts': `export const config = { port: 3000, host: 'localhost' };`,
        'src/env.ts': `export const env = { NODE_ENV: 'development' };`,
        'src/constants.ts': `export const constants = { MAX_ITEMS: 100, TIMEOUT: 5000 };`,
      },
    },
    expectedBehavior: {
      shouldDo: [
        'Call Read for all three files in one response',
        'Report findings after all reads complete',
      ],
      shouldNotDo: [
        'Read one file, wait, read next (sequential when parallel possible)',
        'Ask which file to read first',
      ],
      maxAskUserQuestionCalls: 0,
      requiredTools: ['read'],
    },
    evaluationCriteria: {
      autonomyScore: 5,
      efficiencyScore: 5,
      correctnessScore: 5,
    },
  },
];

// =============================================================================
// 测试执行
// =============================================================================

describe('Autonomy Test Cases', () => {
  it('should have all required fields', () => {
    for (const testCase of AUTONOMY_TEST_CASES) {
      expect(testCase.id).toBeDefined();
      expect(testCase.category).toBeDefined();
      expect(testCase.userInput).toBeDefined();
      expect(testCase.expectedBehavior).toBeDefined();
      expect(testCase.evaluationCriteria).toBeDefined();
    }
  });

  it('should have unique IDs', () => {
    const ids = AUTONOMY_TEST_CASES.map(tc => tc.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should have valid evaluation scores', () => {
    for (const testCase of AUTONOMY_TEST_CASES) {
      const { autonomyScore, efficiencyScore, correctnessScore } = testCase.evaluationCriteria;
      expect(autonomyScore).toBeGreaterThanOrEqual(1);
      expect(autonomyScore).toBeLessThanOrEqual(5);
      expect(efficiencyScore).toBeGreaterThanOrEqual(1);
      expect(efficiencyScore).toBeLessThanOrEqual(5);
      expect(correctnessScore).toBeGreaterThanOrEqual(1);
      expect(correctnessScore).toBeLessThanOrEqual(5);
    }
  });
});

// =============================================================================
// 导出测试用例统计
// =============================================================================

export function getTestCaseStats() {
  const byCategory = AUTONOMY_TEST_CASES.reduce((acc, tc) => {
    acc[tc.category] = (acc[tc.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const avgAutonomy = AUTONOMY_TEST_CASES.reduce((sum, tc) => sum + tc.evaluationCriteria.autonomyScore, 0) / AUTONOMY_TEST_CASES.length;

  return {
    total: AUTONOMY_TEST_CASES.length,
    byCategory,
    avgAutonomyScore: avgAutonomy.toFixed(2),
  };
}