/**
 * KB 检索 golden set —— 判定规则在跑之前写定。
 *
 * 单位是 source 级：判定"期望的文档是否被召回到 top-K"，而不是具体 chunk。
 * 理由：同一事实常横跨相邻 chunk，chunk 级判定会把正确召回误判为失败。
 *
 * literalOverlap 按查询与答案文本的字面重叠度分桶，用于分别报告 —— 融合的收益
 * 集中在 low 桶，混在一起报会被平均掉。
 */

export type LiteralOverlap = 'high' | 'partial' | 'low';

export interface GoldenQuery {
  id: string;
  query: string;
  /** 期望命中的 source 标题片段（runner 会先自检该 source 真的含 answerProbe） */
  expectTitle: string;
  /** 用于自检期望是否成立的关键词，必须真实出现在该 source 文本中 */
  answerProbe: string;
  literalOverlap: LiteralOverlap;
  note?: string;
}

export const GOLDEN_QUERIES: GoldenQuery[] = [
  // ---- 高字面重叠：查询词直接出现在答案里 ----
  { id: 'q01', query: 'GPT-5 Agent Mode', expectTitle: 'ai_startup_dynamics', answerProbe: 'Agent Mode', literalOverlap: 'high' },
  { id: 'q02', query: 'Google DeepMind 人才流失', expectTitle: 'ai_startup_dynamics', answerProbe: '人才流失', literalOverlap: 'high' },
  { id: 'q03', query: 'Vulkan 弃用 host 端加速结构构建', expectTitle: 'graphic-engineering-monthly', answerProbe: '弃用 host', literalOverlap: 'high' },
  { id: 'q04', query: 'SIGGRAPH 2026 Real-Time Live', expectTitle: 'graphic-engineering-monthly', answerProbe: 'Real-Time Live', literalOverlap: 'high' },
  { id: 'q05', query: 'Open Knowledge Format 数据共享', expectTitle: 'OKF_Bilingual', answerProbe: 'Open Knowledge Format', literalOverlap: 'high' },
  { id: 'q06', query: '增强单元', expectTitle: 'AI原生组织架构', answerProbe: '增强单元', literalOverlap: 'high' },
  { id: 'q07', query: '张经理负责联系客户', expectTitle: '张经理', answerProbe: '张经理', literalOverlap: 'high' },
  { id: 'q08', query: 'WebGPU 规范里程碑', expectTitle: 'graphic-engineering-monthly', answerProbe: 'WebGPU', literalOverlap: 'high' },

  // ---- 部分重叠：查询用了答案里的部分词，但换了说法 ----
  { id: 'q09', query: 'Anthropic 是怎么实现盈利的', expectTitle: 'monthly-ai-product-analysis', answerProbe: 'Anthropic', literalOverlap: 'partial' },
  { id: 'q10', query: '哪家公司靠芯片双轨策略', expectTitle: 'ai_startup_dynamics', answerProbe: '芯片双轨', literalOverlap: 'partial' },
  { id: 'q11', query: 'Godot 引擎这个月有什么进展', expectTitle: 'graphic-engineering-monthly', answerProbe: 'Godot', literalOverlap: 'partial' },
  { id: 'q12', query: '组织变革的节奏应该怎么把握', expectTitle: 'AI原生组织架构', answerProbe: '组织变革', literalOverlap: 'partial' },
  { id: 'q13', query: '报价什么时候交', expectTitle: '张经理', answerProbe: '报价', literalOverlap: 'partial' },
  { id: 'q14', query: '市场融资规模创了新高吗', expectTitle: 'ai_startup_dynamics', answerProbe: '历史新高', literalOverlap: 'partial' },

  // ---- 低字面重叠：同义改写，纯词法检索应该失败，向量腿才有机会 ----
  { id: 'q15', query: '为什么模型光有能力还不够用', expectTitle: 'OKF_Bilingual', answerProbe: '缺乏相关', literalOverlap: 'low', note: '答案讲"缺乏上下文限制了能力"' },
  { id: 'q16', query: '大厂之间的竞争态势变化', expectTitle: 'monthly-ai-product-analysis', answerProbe: '竞争格局', literalOverlap: 'low' },
  { id: 'q17', query: '公司里最小的干活单位怎么划分', expectTitle: 'AI原生组织架构', answerProbe: '原子单位', literalOverlap: 'low', note: '答案说"组织的原子单位是增强单元"' },
  { id: 'q18', query: '画面实时生成技术的年度大会', expectTitle: 'graphic-engineering-monthly', answerProbe: 'SIGGRAPH', literalOverlap: 'low' },
  { id: 'q19', query: '谁去跟顾客沟通', expectTitle: '张经理', answerProbe: '联系客户', literalOverlap: 'low', note: '答案是"负责联系客户"' },
  { id: 'q20', query: '上市热潮对行业的影响', expectTitle: 'monthly-ai-product-analysis', answerProbe: 'IPO', literalOverlap: 'low', note: '答案用 IPO 而非"上市"' },

  // ---- 无答案查询：任何实现都应返回空或低分，用于检测虚假召回 ----
  { id: 'q21', query: '如何用高压锅炖牛腩', expectTitle: '__NONE__', answerProbe: '', literalOverlap: 'low', note: '语料中不存在，正确行为是无结果' },
  { id: 'q22', query: '量子计算纠错码的最新阈值', expectTitle: '__NONE__', answerProbe: '', literalOverlap: 'low', note: '同主题邻域但语料无此内容' },
];

/** 判定 top-10 里有多少条是标签/CSS 噪声 —— M1 之后应为 0 */
export const NOISE_PATTERNS: RegExp[] = [
  /<[a-zA-Z/][^>]*>/,
  /\bclass="/,
  /\bdata-section=/,
  /translateY|font-size|@media|rgba\(/,
];
