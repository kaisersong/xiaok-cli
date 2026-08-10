/**
 * Knowledge Base — 查询词提取
 *
 * `ipc.ts` 的 kb:search 与 `kb-tools.ts` 的 kb_search 原先各自写了一份
 * `segmentQuery + split + toLowerCase`，都没有过滤停用词。后果：jieba 把「的」
 * 保留为 token，而几乎所有中文文档都含「的」，于是任意查询都能命中任意文档
 * —— golden set 实测 2/2 条无答案查询被误召，命中分 0.2。
 */
import { segmentQuery } from '../../src/ai/memory/segment.js';

/**
 * 中文虚词与英文冠词/介词。只收对检索无区分度的高频词；像「猫」这类
 * 有实义的单字不在其中，因此不按长度过滤。
 */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '对', '把', '被', '就', '也', '都',
  '而', '其', '之', '为', '以', '于', '由', '从', '到', '向', '等', '个', '这',
  '那', '有', '我', '你', '他', '她', '它', '们', '吗', '呢', '吧', '啊', '着',
  '过', '会', '能', '要', '给', '让', '并', '或', '但', '很', '更', '最', '再',
  '还', '又', '却', '则', '如', '若', '按', '据', '关于', '什么', '怎么', '怎样',
  '哪些', '哪个', '如何', '为什么', '是否', '可以', '应该', '需要', '进行',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
  'and', 'or', 'but', 'for', 'with', 'by', 'from', 'as', 'that', 'this',
  'how', 'what', 'why', 'which', 'do', 'does', 'did', 'be', 'been',
]);

/**
 * 把查询切成用于匹配的去重词表。
 *
 * 全是停用词时返回**过滤前**的词表而不是空数组 —— 否则「什么是 AI」这类
 * 查询会因为过滤过度而完全查不到东西。
 */
export function extractQueryTerms(query: string): string[] {
  const all = [...new Set(
    segmentQuery(query).split(/\s+/).filter(Boolean).map(term => term.toLowerCase()),
  )];
  const meaningful = all.filter(term => !STOP_WORDS.has(term));
  return meaningful.length > 0 ? meaningful : all;
}
