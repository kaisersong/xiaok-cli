import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Tool } from '../../types.js';
import {
  A2UI_MIME_TYPE,
  compileRenderUiToA2ui,
  formatA2UIBytes,
  RENDER_UI_SECTION_KINDS,
  sanitizeA2UIIdPart,
} from '../../a2ui/index.js';
import { assertWorkspacePath } from '../permissions/workspace.js';
import { getConfigDir } from '../../utils/config.js';
import type { WorkspaceToolOptions } from './read.js';

const renderUiSectionSchema = {
  oneOf: [
    {
      type: 'object',
      description: '标题。必须使用 kind: "heading"。',
      properties: {
        kind: { type: 'string', enum: ['heading'] },
        text: { type: 'string', description: '标题文本' },
        level: { type: 'number', enum: [1, 2, 3], description: '标题级别，默认 2' },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: '说明文字。必须使用 kind: "text"，正文放在 content 字段。',
      properties: {
        kind: { type: 'string', enum: ['text'] },
        content: { type: 'string', description: '正文内容，不要使用 text 字段作为正式格式' },
      },
      required: ['kind', 'content'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: '指标卡。必须使用 kind: "metric"。',
      properties: {
        kind: { type: 'string', enum: ['metric'] },
        label: { type: 'string' },
        value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        change: { type: 'string' },
      },
      required: ['kind', 'label', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: '只读表格。必须使用 kind: "table"。',
      properties: {
        kind: { type: 'string', enum: ['table'] },
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array' } },
      },
      required: ['kind', 'columns', 'rows'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: '只读列表。必须使用 kind: "list"。',
      properties: {
        kind: { type: 'string', enum: ['list'] },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'items'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: '分隔线。必须使用 kind: "divider"。',
      properties: {
        kind: { type: 'string', enum: ['divider'] },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
};

export function createRenderUiTool(options: WorkspaceToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const allowOutsideCwd = options.allowOutsideCwd ?? false;
  const artifactRoot = options.artifactRoot ?? getConfigDir('artifacts');

  return {
    permission: 'write',
    definition: {
      name: 'render_ui',
      description: [
        `生成只读 A2UI 交互式 UI artifact。sections 必须使用 kind 字段，支持 ${RENDER_UI_SECTION_KINDS.join('/')}；text 正文使用 content 字段。禁止表单、脚本、链接、事件和自定义样式。`,
        '返回短 JSON ack；完整 UI payload 会写入 output_path 指向的 .a2ui.json 文件。',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'UI 标题' },
          output_path: { type: 'string', description: '可选，.a2ui.json 输出路径；缺省写入用户级小 K artifacts 目录' },
          task_id: { type: 'string', description: '可选，用于生成稳定 surfaceId' },
          data: { type: 'object', description: '可选，原始数据；compiler 只写入组件实际引用的数据' },
          sections: {
            type: 'array',
            description: `只读 section 列表。每项必须使用 kind 字段，支持 ${RENDER_UI_SECTION_KINDS.join('/')}。`,
            items: renderUiSectionSchema,
          },
        },
        required: ['title', 'sections'],
      },
    },
    async execute(input, context) {
      const taskId = typeof input.task_id === 'string' && input.task_id.trim()
        ? input.task_id.trim()
        : context?.session?.sessionId ?? 'local';
      const toolUseId = `tool_${Date.now().toString(36)}`;
      const compiled = compileRenderUiToA2ui(input as never, { taskId, toolUseId });
      const defaultFilename = `${sanitizeA2UIIdPart(compiled.surfaceId)}.a2ui.json`;
      const explicitOutputPath = typeof input.output_path === 'string' ? input.output_path.trim() : '';
      const requestedPath = explicitOutputPath || join(artifactRoot, defaultFilename);
      const outputPath = explicitOutputPath
        ? assertWorkspacePath(requestedPath, cwd, 'write', allowOutsideCwd)
        : requestedPath;
      if (!outputPath.endsWith('.a2ui.json')) {
        throw new Error('output_path 必须以 .a2ui.json 结尾');
      }

      const payload = JSON.stringify(compiled.messages, null, 2);
      mkdirSync(dirname(outputPath), { recursive: true });
      const tmp = join(dirname(outputPath), `.xiaok-a2ui-${Date.now()}.tmp`);
      writeFileSync(tmp, payload, 'utf8');
      renameSync(tmp, outputPath);

      const title = typeof input.title === 'string' ? input.title : 'A2UI';
      return JSON.stringify({
        ok: true,
        surfaceId: compiled.surfaceId,
        artifactId: `artifact_${compiled.surfaceId}`,
        artifactPath: outputPath,
        output_path: outputPath,
        title,
        mimeType: A2UI_MIME_TYPE,
        componentCount: compiled.componentCount,
        payloadSize: formatA2UIBytes(compiled.payloadBytes),
        artifacts: [{
          artifactId: `artifact_${compiled.surfaceId}`,
          type: 'artifact',
          title,
          key: outputPath,
          filename: basename(outputPath),
          mime_type: A2UI_MIME_TYPE,
          size: compiled.payloadBytes,
          display: 'inline',
        }],
      });
    },
  };
}
