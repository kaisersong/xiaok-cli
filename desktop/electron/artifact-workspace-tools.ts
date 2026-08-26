import type { Tool, ToolExecutionContext } from '../../src/types.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createEditTool } from '../../src/ai/tools/edit.js';
import { createReadTool } from '../../src/ai/tools/read.js';
import { createWriteTool } from '../../src/ai/tools/write.js';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { ArtifactWorkspaceError } from '../shared/artifact-workspace-types.js';
import type { ArtifactWorkspaceClaimResult, ArtifactWorkspaceService } from './artifact-workspace-service.js';

type ClaimService = Pick<ArtifactWorkspaceService, 'claimProducedArtifact'> | {
  claimProducedArtifact(input: Parameters<ArtifactWorkspaceService['claimProducedArtifact']>[0]): Promise<ArtifactWorkspaceClaimResult>;
};

type AllowedAction = 'fulfill_placeholder' | 'append_revision' | 'append_collection_item';

type RequestedKindResolver = (leaseId: string) => 'image' | 'html' | 'markdown' | 'slides' | undefined;

function generationTaskRoot(generationRoot: string, context?: ToolExecutionContext): string | undefined {
  const scope = context?.executionScope;
  if (!scope || scope.kind !== 'artifact_workspace_generation' || !/^[a-zA-Z0-9_-]+$/.test(scope.leaseId)) {
    return undefined;
  }
  return join(resolve(generationRoot), scope.leaseId);
}

function assertWritableGenerationPath(taskRoot: string, filePath: unknown): string {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('file_path is required');
  const resolvedPath = resolve(taskRoot, filePath);
  const rel = relative(taskRoot, resolvedPath);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('permission_denied: output must stay inside the lease directory');
  }
  const sourceRoot = resolve(taskRoot, 'source');
  const sourceRel = relative(sourceRoot, resolvedPath);
  if (sourceRel === '' || (!sourceRel.startsWith('..') && !isAbsolute(sourceRel))) {
    throw new Error('permission_denied: immutable source copies are read-only');
  }
  return resolvedPath;
}

function outputContract(kind: ReturnType<RequestedKindResolver>, filePath: string): { kind: string; mimeType: string } {
  const extension = extname(filePath).toLowerCase();
  if (kind === 'markdown' && ['.md', '.markdown'].includes(extension)) return { kind, mimeType: 'text/markdown' };
  if (kind === 'image' && extension === '.svg') return { kind, mimeType: 'image/svg+xml' };
  if (kind === 'html' || kind === 'slides') {
    throw new Error(`plugin_unavailable: final ${kind} output must be produced by its bundled renderer`);
  }
  throw new Error(`artifact_kind_mismatch: output extension does not match requested ${kind ?? 'unknown'} kind`);
}

function artifactAck(
  leaseId: string,
  kind: ReturnType<RequestedKindResolver>,
  filePath: string,
  producer?: { pluginSource: string; mimeType: string },
): string {
  let contract: ReturnType<typeof outputContract>;
  if (producer && kind) {
    contract = { kind, mimeType: producer.mimeType };
  } else {
    try {
      contract = outputContract(kind, filePath);
    } catch (error) {
      if (['.draft', '.tmp'].includes(extname(filePath).toLowerCase())) {
        return JSON.stringify({ ok: true, draft: true, title: basename(filePath) });
      }
      throw error;
    }
  }
  const artifactId = `artifact_${createHash('sha256').update(`${leaseId}:${filePath}`).digest('hex').slice(0, 20)}`;
  return JSON.stringify({
    ok: true,
    artifactWorkspaceArtifact: true,
    artifactId,
    artifactPath: filePath,
    output_path: filePath,
    title: basename(filePath),
    ...(producer ? { creator: `plugin:${producer.pluginSource}`, pluginSource: producer.pluginSource } : {}),
    ...contract,
  });
}

function producerInputSchema(tool: Tool): Tool['definition']['inputSchema'] {
  const source = tool.definition.inputSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  const properties = { ...(source.properties ?? {}) };
  delete properties.output_path;
  return {
    ...source,
    type: 'object',
    properties,
    required: (source.required ?? []).filter(name => name !== 'output_path'),
    additionalProperties: false,
  } as Tool['definition']['inputSchema'];
}

export function createArtifactWorkspacePluginProducerTool(options: {
  generationRoot: string;
  resolveRequestedKind: RequestedKindResolver;
  tool: Tool;
  requestedKind: 'html' | 'slides';
  outputFileName: string;
  pluginSource: 'kai-report-creator' | 'kai-slide-creator';
  mimeType: 'text/html' | 'application/vnd.xiaok.slides+html';
}): Tool {
  return {
    permission: 'write',
    definition: {
      ...options.tool.definition,
      description: `${options.tool.definition.description} Artifact Workspace 会忽略模型提供的输出路径，并把结果强制写入当前 lease 目录。严禁写入其他路径。`,
      inputSchema: producerInputSchema(options.tool),
    },
    async execute(input, context) {
      const taskRoot = generationTaskRoot(options.generationRoot, context);
      const scope = context?.executionScope;
      if (!taskRoot || scope?.kind !== 'artifact_workspace_generation') {
        return 'Error: permission_denied: artifact workspace execution scope is missing';
      }
      if (options.resolveRequestedKind(scope.leaseId) !== options.requestedKind) {
        return `Error: ${JSON.stringify({ ok: false, error: { code: 'artifact_kind_mismatch' } })}`;
      }
      mkdirSync(taskRoot, { recursive: true });
      const outputPath = join(taskRoot, options.outputFileName);
      const response = await options.tool.execute({ ...input, output_path: outputPath }, context);
      if (typeof response === 'string' && response.startsWith('Error:')) return response;
      let parsed: Record<string, unknown> | undefined;
      if (typeof response === 'string') {
        try {
          const value = JSON.parse(response) as unknown;
          if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
        } catch {}
      }
      if (parsed?.success === false || parsed?.ok === false || !existsSync(outputPath)) {
        return `Error: ${JSON.stringify({
          ok: false,
          error: { code: 'plugin_unavailable', pluginSource: options.pluginSource },
        })}`;
      }
      return artifactAck(scope.leaseId, options.requestedKind, outputPath, {
        pluginSource: options.pluginSource,
        mimeType: options.mimeType,
      });
    },
  };
}

export function createArtifactWorkspaceUnavailableProducerTool(options: {
  name: string;
  pluginSource: 'kai-report-creator' | 'kai-slide-creator';
  requestedKind: 'html' | 'slides';
  properties: Record<string, unknown>;
  required: string[];
}): Tool {
  return {
    permission: 'write',
    definition: {
      name: options.name,
      description: `使用 ${options.pluginSource} 生成 ${options.requestedKind} 产物。当前 renderer 不可用时返回结构化 plugin_unavailable；严禁改用手写弱化产物。`,
      inputSchema: {
        type: 'object',
        properties: options.properties,
        required: options.required,
        additionalProperties: false,
      },
    },
    async execute() {
      return `Error: ${JSON.stringify({
        ok: false,
        error: { code: 'plugin_unavailable', pluginSource: options.pluginSource },
      })}`;
    },
  };
}

function createScopedReadTool(generationRoot: string): Tool {
  const definitionSource = createReadTool({ cwd: resolve(generationRoot) });
  return {
    permission: definitionSource.permission,
    definition: definitionSource.definition,
    async execute(input, context) {
      const taskRoot = generationTaskRoot(generationRoot, context);
      if (!taskRoot) return 'Error: permission_denied: artifact workspace execution scope is missing';
      return createReadTool({ cwd: taskRoot }).execute(input, context);
    },
  };
}

function createScopedOutputTool(
  generationRoot: string,
  name: 'write' | 'edit',
  resolveRequestedKind: RequestedKindResolver,
): Tool {
  const factory = name === 'write' ? createWriteTool : createEditTool;
  const definitionSource = factory({ cwd: resolve(generationRoot) });
  return {
    permission: definitionSource.permission,
    definition: {
      ...definitionSource.definition,
      description: `${definitionSource.definition.description} 输出只能位于当前 lease 目录；source/ 不可写。成功结果会返回可供 artifact_workspace_* claim 的 artifactId。`,
    },
    async execute(input, context) {
      const taskRoot = generationTaskRoot(generationRoot, context);
      const scope = context?.executionScope;
      if (!taskRoot || scope?.kind !== 'artifact_workspace_generation') {
        return 'Error: permission_denied: artifact workspace execution scope is missing';
      }
      const outputPath = assertWritableGenerationPath(taskRoot, input.file_path);
      const requestedKind = resolveRequestedKind(scope.leaseId);
      if (!['.draft', '.tmp'].includes(extname(outputPath).toLowerCase())) {
        outputContract(requestedKind, outputPath);
      }
      const result = await factory({ cwd: taskRoot }).execute({ ...input, file_path: outputPath }, context);
      if (result.startsWith('Error:')) return result;
      return artifactAck(scope.leaseId, requestedKind, outputPath);
    },
  };
}

/**
 * Artifact generation deliberately receives no shell, skill install, glob, grep,
 * or general project tool. Every filesystem operation is rebound from the
 * host-owned executionScope to one immutable lease directory.
 */
export function createArtifactWorkspaceGenerationFileTools(
  generationRoot: string,
  resolveRequestedKind: RequestedKindResolver = () => undefined,
): Tool[] {
  return [
    createScopedReadTool(generationRoot),
    createScopedOutputTool(generationRoot, 'write', resolveRequestedKind),
    createScopedOutputTool(generationRoot, 'edit', resolveRequestedKind),
  ];
}

const NARROW_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    leaseId: {
      type: 'string',
      description: '当前 host executionScope 注入的一次性 generation lease ID。',
    },
    producedArtifactId: {
      type: 'string',
      description: '当前任务 TaskSnapshot 已记录的 artifactId。',
    },
  },
  required: ['leaseId', 'producedArtifactId'],
  additionalProperties: false,
} as const;

const TOOL_SPECS: Array<{ name: string; action: AllowedAction; description: string }> = [
  {
    name: 'artifact_workspace_fulfill_placeholder',
    action: 'fulfill_placeholder',
    description: '将当前 generation task 已记录的产物登记到其绑定 placeholder。只能使用 host 注入 executionScope 对应的一次性 lease 和当前任务 artifactId；严禁传入路径、workspaceId、taskId、requestSource，严禁操作其他任务或用户数据。',
  },
  {
    name: 'artifact_workspace_append_revision',
    action: 'append_revision',
    description: '把当前 generation task 已记录的产物追加为绑定来源的不可变 revision。只能使用 host 注入 executionScope 对应的一次性 lease 和当前任务 artifactId；严禁覆盖/删除来源，严禁传入路径或任何授权身份字段。',
  },
  {
    name: 'artifact_workspace_append_collection_item',
    action: 'append_collection_item',
    description: '把当前 generation task 已记录的产物登记为绑定 collection request 的新条目。只能使用 host 注入 executionScope 对应的一次性 lease 和当前任务 artifactId；严禁修改其他 collection，严禁传入路径或任何授权身份字段。',
  },
];

export function createArtifactWorkspaceTools(service: ClaimService): Tool[] {
  return TOOL_SPECS.map((spec): Tool => ({
    permission: 'write',
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: NARROW_INPUT_SCHEMA,
    },
    async execute(input: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
      const leaseId = typeof input.leaseId === 'string' ? input.leaseId.trim() : '';
      const producedArtifactId = typeof input.producedArtifactId === 'string' ? input.producedArtifactId.trim() : '';
      if (
        !context?.taskId
        || context.executionScope?.kind !== 'artifact_workspace_generation'
        || !leaseId
        || !producedArtifactId
      ) {
        return `Error: ${JSON.stringify({ ok: false, error: { code: 'permission_denied' } })}`;
      }
      try {
        const result = await service.claimProducedArtifact({
          leaseId,
          producedArtifactId,
          taskId: context.taskId,
          executionScope: context.executionScope,
          expectedAction: spec.action,
          projectionKind: 'narrow_tool',
        });
        if (result.outcomeKind === 'staging') {
          const code = result.quarantineReason === 'kind_mismatch'
            ? 'artifact_kind_mismatch'
            : result.quarantineReason === 'invalid_artifact_ref'
              ? 'invalid_target'
              : 'permission_denied';
          return `Error: ${JSON.stringify({ ok: false, error: { code }, stagingId: result.stagingId })}`;
        }
        return JSON.stringify({ ok: true, ...result });
      } catch (error) {
        if (error instanceof ArtifactWorkspaceError) {
          return `Error: ${JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })}`;
        }
        return `Error: ${JSON.stringify({ ok: false, error: { code: 'runtime_unavailable' } })}`;
      }
    },
  }));
}
