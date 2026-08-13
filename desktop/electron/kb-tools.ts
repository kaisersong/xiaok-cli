/**
 * Knowledge Base — Agent Tools
 *
 * Exposes kb_list_collections, kb_create_collection, kb_search,
 * kb_get_source to the agent runtime.
 */

import type { Tool } from '../../src/types.js';
import type { KbStore, KbRetriever, SourceExtractor, SourceExtractionResult } from './kb-store.js';
import { extractQueryTerms, meetsRelevanceFloor } from './kb-query-terms.js';

export function createKbTools(
  store: KbStore,
  retriever: KbRetriever,
  options: { sourceExtractor?: SourceExtractor } = {},
): Tool[] {
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
      permission: 'write',
      definition: {
        name: 'kb_add_source',
        description: '向知识库创建一个新的内容来源。只能创建本次调用拥有的新 source；严禁覆盖、重解析、删除或归档已有用户 source。支持 paste、file、url，写入后自动分片索引。',
        inputSchema: {
          type: 'object',
          properties: {
            collection_id: { type: 'string', description: '目标集合 ID，不传则使用第一个集合' },
            title: { type: 'string', description: '文档标题' },
            kind: { type: 'string', enum: ['paste', 'file', 'url'], description: '写入方式：paste=文本内容, file=本地文件, url=网页' },
            text: { type: 'string', description: 'kind=paste 时必填，要写入的文本内容' },
            file_path: { type: 'string', description: 'kind=file 时必填，本地文件路径' },
            url: { type: 'string', description: 'kind=url 时必填，网页地址' },
          },
          required: ['title', 'kind'],
        },
      },
      async execute(input) {
        const kind = input.kind as string;
        const title = (input.title as string || '').trim();
        if (!title) return '错误：title 不能为空。';

        let collectionId = input.collection_id as string | undefined;
        if (!collectionId) {
          const cols = store.listCollections();
          if (cols.length === 0) return '错误：知识库中没有集合，请先用 kb_create_collection 创建一个。';
          collectionId = cols[0].id;
        }

        if (kind === 'paste') {
          const text = (input.text as string || '').trim();
          if (!text) return '错误：kind=paste 时 text 不能为空。';
          const source = store.addSource({ collectionId, kind: 'paste', title, text }, 'agent');
          const chunks = simpleChunk(text);
          store.insertChunks(source.id, chunks);
          markSourceParsed(store, source.id, { engine: 'builtin-text' });
          return `已写入「${title}」到知识库（${chunks.length} 片段）。`;
        }

        if (kind === 'file') {
          const filePath = (input.file_path as string || '').trim();
          if (!filePath) return '错误：kind=file 时 file_path 不能为空。';
          const source = store.addSource({ collectionId, kind: 'file', title, filePath }, 'agent');
          try {
            const extractor = options.sourceExtractor;
            if (!extractor) throw new Error('source_extractor_unavailable');
            const extracted = await extractor.extract({ filePath, mimeType: 'application/octet-stream' });
            if (!extracted.ok || !extracted.text) {
              markSourceFailed(store, source.id, extracted);
              return `错误：读取文件失败 — ${extracted.errorCode ?? 'extraction_failed'}: ${extracted.error ?? 'unknown'}`;
            }
            const chunks = simpleChunk(extracted.text);
            store.insertChunks(source.id, chunks);
            markSourceParsed(store, source.id, extractionMetadata(extracted));
            return `已写入文件「${title}」到知识库（${chunks.length} 片段）。`;
          } catch (e) {
            markSourceFailed(store, source.id, {
              ok: false,
              errorCode: 'io_error',
              error: e instanceof Error ? e.message : String(e),
            });
            return `错误：读取文件失败 — ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        if (kind === 'url') {
          const url = (input.url as string || '').trim();
          if (!url) return '错误：kind=url 时 url 不能为空。';
          const source = store.addSource({ collectionId, kind: 'url', title, uri: url }, 'agent');
          try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
            if (!resp.ok) {
              markSourceFailed(store, source.id, {
                ok: false,
                errorCode: 'io_error',
                error: `HTTP ${resp.status}`,
              });
              return `错误：抓取 URL 失败 — HTTP ${resp.status}`;
            }
            const text = await resp.text();
            const plainText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const chunks = simpleChunk(plainText);
            store.insertChunks(source.id, chunks);
            markSourceParsed(store, source.id, { engine: 'builtin-url' });
            return `已写入 URL「${title}」到知识库（${chunks.length} 片段）。`;
          } catch (e) {
            markSourceFailed(store, source.id, {
              ok: false,
              errorCode: 'io_error',
              error: e instanceof Error ? e.message : String(e),
            });
            return `错误：抓取 URL 失败 — ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        return '错误：kind 必须是 paste、file 或 url 之一。';
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
            collection_id: { type: 'string', description: '集合 ID，不传则使用默认集合' },
            source_ids: { type: 'array', items: { type: 'string' }, description: '可选：限定到指定 source' },
            top_k: { type: 'number', description: '返回条数，默认 10' },
          },
          required: ['query'],
        },
      },
      async execute(input) {
        const query = (input.query as string || '').trim();
        if (!query) return '未找到相关内容。';
        let collectionId = input.collection_id as string | undefined;
        if (!collectionId) {
          const cols = store.listCollections();
          if (cols.length === 0) return '知识库为空，还没有任何集合。';
          collectionId = cols[0].id;
        }
        const sourceIds = input.source_ids as string[] | undefined;
        const topK = (input.top_k as number) || 10;

        const uniqueTerms = extractQueryTerms(query);
        if (uniqueTerms.length === 0) return '未找到相关内容。';

        const allSources = store.listSources(collectionId);
        const filteredSources = sourceIds?.length ? allSources.filter(s => sourceIds.includes(s.id)) : allSources;
        const results: Array<{ sourceTitle: string; text: string; pageIndex: number | null; slideIndex: number | null; sheetName: string | null; score: number }> = [];

        for (const src of filteredSources) {
          const srcChunks = store.listChunks(src.id);
          for (const chunk of srcChunks) {
            const lower = chunk.text.toLowerCase();
            const matchCount = uniqueTerms.filter(t => lower.includes(t)).length;
            const score = matchCount / uniqueTerms.length;
            if (meetsRelevanceFloor(score)) {
              results.push({
                sourceTitle: src.title,
                text: chunk.text,
                pageIndex: chunk.pageIndex,
                slideIndex: chunk.slideIndex,
                sheetName: chunk.sheetName,
                score,
              });
            }
          }
        }

        results.sort((a, b) => b.score - a.score);
        const top = results.slice(0, topK);
        if (top.length === 0) return '未找到相关内容。';
        return top.map((r, i) => {
          const loc = r.pageIndex != null ? ` [第${r.pageIndex + 1}页]` : r.slideIndex != null ? ` [幻灯片${r.slideIndex + 1}]` : r.sheetName ? ` [${r.sheetName}]` : '';
          return `${i + 1}. 「${r.sourceTitle}」${loc} (score: ${r.score.toFixed(3)})\n   ${r.text.slice(0, 200)}`;
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

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

function simpleChunk(text: string): Array<{ idx: number; text: string; charStart: number; charEnd: number }> {
  const chunks: Array<{ idx: number; text: string; charStart: number; charEnd: number }> = [];
  let start = 0;
  let idx = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push({ idx, text: text.slice(start, end), charStart: start, charEnd: end });
    idx++;
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }
  return chunks;
}

function markSourceParsed(store: KbStore, sourceId: string, metadata: Record<string, unknown>): void {
  store.updateSourceParseResult(sourceId, { parseStatus: 'parsed', metadata }, 'agent');
}

function markSourceFailed(store: KbStore, sourceId: string, result: SourceExtractionResult): void {
  const current = store.getSource(sourceId);
  if (!current || current.parseStatus !== 'pending') return;
  store.updateSourceParseResult(sourceId, {
    parseStatus: result.errorCode === 'unsupported_format' ? 'unsupported' : 'failed',
    errorCode: result.errorCode ?? 'extraction_failed',
    errorMessage: result.error ?? 'unknown',
    metadata: extractionMetadata(result),
  }, 'agent');
}

function extractionMetadata(result: SourceExtractionResult): Record<string, unknown> {
  return {
    ...(result.engine ? { engine: result.engine } : {}),
    ...(result.engineVersion ? { engineVersion: result.engineVersion } : {}),
    ...(result.truncated !== undefined ? { truncated: result.truncated } : {}),
  };
}
