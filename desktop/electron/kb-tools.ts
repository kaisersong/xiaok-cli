/**
 * Knowledge Base — Agent Tools
 *
 * Exposes kb_list_collections, kb_create_collection, kb_search,
 * kb_get_source to the agent runtime.
 */

import type { Tool } from '../../src/types.js';
import type { KbStore, KbRetriever } from './kb-store.js';

export function createKbTools(store: KbStore, retriever: KbRetriever): Tool[] {
  return [
    {
      permission: 'safe',
      definition: {
        name: 'kb_list_collections',
        description: '列出所有知识库集合（collection），返回名称、ID、文档数、嵌入模型等信息。',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      async execute() {
        const collections = store.listCollections();
        if (collections.length === 0) return '知识库中还没有集合。';
        return collections.map(c =>
          `[${c.id}] ${c.name} — ${c.chunkCountCached} 片段, 模型: ${c.embeddingModelId}`
        ).join('\n');
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'kb_create_collection',
        description: '创建一个新的知识库集合。',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '集合名称' },
            description: { type: 'string', description: '可选描述' },
            embeddingModelId: { type: 'string', description: '嵌入模型 ID（如 bge-small-zh-v1.5）' },
            embeddingDim: { type: 'number', description: '嵌入维度（如 512）' },
          },
          required: ['name', 'embeddingModelId', 'embeddingDim'],
        },
      },
      async execute(input) {
        const col = store.createCollection({
          name: input.name as string,
          description: input.description as string | undefined,
          embeddingModelId: input.embeddingModelId as string,
          embeddingDim: input.embeddingDim as number,
        });
        return `已创建集合「${col.name}」(${col.id})`;
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'kb_search',
        description: '【知识检索】在用户的知识库中搜索已保存的文档和资料。当用户提问涉及知识、资料、文档内容时优先使用此工具。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词或问题' },
            collection_id: { type: 'string', description: '集合 ID（必填）' },
            source_ids: { type: 'array', items: { type: 'string' }, description: '可选：限定到指定 source' },
            top_k: { type: 'number', description: '返回条数，默认 10' },
          },
          required: ['query', 'collection_id'],
        },
      },
      async execute(input) {
        const results = await retriever.search({
          query: input.query as string,
          collectionId: input.collection_id as string,
          sourceIds: input.source_ids as string[] | undefined,
          topK: (input.top_k as number) || 10,
        });
        if (results.length === 0) return '未找到相关内容。';
        return results.map((r, i) => {
          const loc = r.pageIndex != null ? ` [第${r.pageIndex + 1}页]` : r.slideIndex != null ? ` [幻灯片${r.slideIndex + 1}]` : r.sheetName ? ` [${r.sheetName}]` : '';
          return `${i + 1}. 「${r.sourceTitle}」${loc} (score: ${r.fusedScore.toFixed(3)})\n   ${r.text.slice(0, 200)}`;
        }).join('\n\n');
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'kb_get_source',
        description: '获取知识库中某个 source 的全文内容（支持分页）。用于"总结这份文档"等整文意图。',
        inputSchema: {
          type: 'object',
          properties: {
            source_id: { type: 'string', description: 'Source ID' },
            offset: { type: 'number', description: '字符偏移，默认 0' },
            limit: { type: 'number', description: '读取字符数，默认 32000' },
          },
          required: ['source_id'],
        },
      },
      async execute(input) {
        const result = store.getSourceWithContent(
          input.source_id as string,
          (input.offset as number) || 0,
          (input.limit as number) || 32_000,
        );
        if (!result) return 'Source 不存在。';
        if (result.source.parseStatus !== 'parsed') {
          return `Source 尚未就绪（状态：${result.source.parseStatus}）。请稍候再试。`;
        }
        const outlineText = result.outline.length > 0
          ? '\n大纲：\n' + result.outline.map(o => `  ${o.kind} ${o.index + 1}${o.title ? ': ' + o.title : ''}`).join('\n')
          : '';
        const moreHint = result.hasMore ? `\n\n[还有更多内容，使用 offset=${result.nextOffset} 继续读取]` : '';
        return `来源: ${result.source.title} (${result.totalChars} 字)${outlineText}\n\n---\n${result.text}${moreHint}`;
      },
    },
  ];
}
