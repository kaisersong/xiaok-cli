import { createServer } from 'node:http';

import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { loadCustomAgents } from '../ai/agents/loader.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { ToolRegistry, buildToolList } from '../ai/tools/index.js';
import { bashTool } from '../ai/tools/bash.js';
import { createSkillCatalog, type SkillCatalog } from '../ai/skills/loader.js';
import { createSkillTool, formatSkillPayload } from '../ai/skills/tool.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import type { Tool, YZJChannelConfig } from '../types.js';
import { ChannelAgentService } from '../channels/agent-service.js';
import { InMemoryApprovalStore } from '../channels/approval-store.js';
import { parseYZJCommand } from '../channels/command-parser.js';
import { InMemoryChannelSessionStore } from '../channels/session-store.js';
import { InMemorySessionBindingStore, type SessionBinding } from '../channels/session-binding-store.js';
import { TaskManager } from '../channels/task-manager.js';
import type { ApprovalAction, ChannelReplyTarget } from '../channels/types.js';
import type { ChannelRequest } from '../channels/webhook.js';
import { handleChannelRequest } from '../channels/worker.js';
import { YZJInboundDedupeStore } from '../channels/yzj-dedupe-store.js';
import { YZJRuntimeNotifier } from '../channels/yzj-runtime-notifier.js';
import { createYZJWebhookHandler } from '../channels/yzj-webhook.js';
import { YZJWebSocketClient } from '../channels/yzj-websocket-client.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { parseYZJMessage, resolveYZJConfig } from '../channels/yzj.js';
import { deriveYZJWebSocketUrl } from '../channels/yzj-ws-url.js';

interface YZJServeOptions {
  sendMsgUrl?: string;
  inboundMode?: 'webhook' | 'websocket';
  webhookPath?: string;
  webhookPort?: string;
  secret?: string;
  webhook?: boolean;
  dryRun?: boolean;
}

interface SessionSkillCatalogState {
  cwd: string;
  catalog: SkillCatalog;
}

function buildOverrides(options: YZJServeOptions): Partial<YZJChannelConfig> {
  return {
    sendMsgUrl: options.sendMsgUrl,
    inboundMode: options.inboundMode,
    webhookPath: options.webhookPath,
    webhookPort: options.webhookPort ? Number(options.webhookPort) : undefined,
    secret: options.secret,
  };
}

export function registerYZJCommands(program: Command): void {
  const yzj = program.command('yzj').description('运行云之家 IM channel gateway');
  const yzjConfigCmd = yzj.command('config').description('管理 YZJ 配置');

  yzjConfigCmd
    .command('show')
    .description('显示当前 YZJ 配置')
    .action(async () => {
      const config = await loadConfig();
      console.log(JSON.stringify(config.channels?.yzj ?? null, null, 2));
    });

  yzjConfigCmd
    .command('set-send-msg-url <url>')
    .description('设置 YZJ sendMsgUrl')
    .action(async (url: string) => {
      await updateYZJConfig((current) => ({ ...current, sendMsgUrl: url }));
      console.log('已设置 channels.yzj.sendMsgUrl');
    });

  yzjConfigCmd
    .command('set-inbound-mode <mode>')
    .description('设置 YZJ 入站模式（webhook / websocket）')
    .action(async (mode: string) => {
      if (mode !== 'webhook' && mode !== 'websocket') {
        console.error('inbound-mode 仅支持 webhook 或 websocket');
        return;
      }
      await updateYZJConfig((current) => ({ ...current, inboundMode: mode }));
      console.log(`已设置 channels.yzj.inboundMode = ${mode}`);
    });

  yzjConfigCmd
    .command('set-webhook-path <path>')
    .description('设置 YZJ webhook 路径')
    .action(async (path: string) => {
      await updateYZJConfig((current) => ({ ...current, webhookPath: path }));
      console.log(`已设置 channels.yzj.webhookPath = ${path}`);
    });

  yzjConfigCmd
    .command('set-webhook-port <port>')
    .description('设置 YZJ webhook 监听端口')
    .action(async (port: string) => {
      const parsed = Number(port);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error('webhook-port 必须是正整数');
        return;
      }
      await updateYZJConfig((current) => ({ ...current, webhookPort: parsed }));
      console.log(`已设置 channels.yzj.webhookPort = ${parsed}`);
    });

  yzjConfigCmd
    .command('set-secret <secret>')
    .description('设置 YZJ webhook 签名 secret')
    .action(async (secret: string) => {
      await updateYZJConfig((current) => ({ ...current, secret }));
      console.log('已设置 channels.yzj.secret');
    });

  const serve = yzj
    .command('serve')
    .description('启动 YZJ WebSocket/Webhook 常驻网关')
    .argument('[sendMsgUrl]', '云之家 webhook/sendMsgUrl；提供后默认按 websocket 模式连接')
    .option('--send-msg-url <url>', '覆盖 channels.yzj.sendMsgUrl')
    .option('--inbound-mode <mode>', '入站模式：websocket | webhook')
    .option('--webhook-path <path>', 'Webhook 接收路径')
    .option('--webhook-port <port>', 'Webhook 监听端口')
    .option('--secret <secret>', 'Webhook 签名校验 secret')
    .option('--no-webhook', '关闭 webhook fallback')
    .option('--dry-run', '验证网关收发链路，不要求模型 API Key，也不实际回发 YZJ 消息');

  serve.action(async (...args: unknown[]) => {
    const sendMsgUrl = typeof args[0] === 'string' ? args[0] : undefined;
    const command = args.find((arg): arg is Command => typeof (arg as Command | undefined)?.opts === 'function');
    const options = command
      ? command.opts<YZJServeOptions>()
      : (args.find((arg): arg is YZJServeOptions => Boolean(arg) && typeof arg === 'object') ?? {});
    await runYZJServe({
      ...options,
      sendMsgUrl: options.sendMsgUrl ?? sendMsgUrl,
    });
  });
}

async function runYZJServe(options: YZJServeOptions): Promise<void> {
  const config = await loadConfig();
  const yzjConfig = resolveYZJConfig(config, buildOverrides(options));
  const enableWebhook = options.webhook ?? true;

  if (yzjConfig.inboundMode === 'webhook' && !enableWebhook) {
    throw new Error('inboundMode=webhook 时不能关闭 webhook server');
  }

  const transport = new YZJTransport({
    sendMsgUrl: yzjConfig.sendMsgUrl,
    logger: console,
  });
  const sessionStore = new InMemoryChannelSessionStore();
  const dedupeStore = new YZJInboundDedupeStore();
  const approvalStore = new InMemoryApprovalStore();
  const bindingStore = new InMemorySessionBindingStore();
  const sessionSkillCatalogs = new Map<string, SessionSkillCatalogState>();

  const deliverText = async (
    target: ChannelReplyTarget,
    text: string,
    kind: 'status' | 'approval' | 'result' = 'result'
  ): Promise<void> => {
    if (options.dryRun) {
      console.info(`[yzj][dry-run] outbound ${kind}: ${text}`);
      return;
    }
    await transport.deliver({
      channel: 'yzj',
      target,
      text,
      kind,
    });
  };

  const notifyText = async (
    request: ChannelRequest,
    text: string,
    kind: 'status' | 'approval' | 'result' = 'result'
  ): Promise<void> => {
    await deliverText(request.replyTarget, text, kind);
  };

  const taskManager = new TaskManager({
    execute: async ({ request, sessionId, signal }) => {
      console.info(
        `[yzj] task execute session=${sessionId} chars=${request.message.length} aborted=${signal.aborted ? 'yes' : 'no'}`
      );
      if (!agentService) {
        if (signal.aborted) {
          return {
            ok: false,
            cancelled: true,
            generationMs: 0,
            deliveryMs: 0,
            replyLength: 0,
            errorMessage: 'agent aborted',
          };
        }
        console.info(`[yzj][dry-run] inbound text: ${request.message}`);
        return {
          ok: true,
          generationMs: 0,
          deliveryMs: 0,
          replyLength: 0,
          replyPreview: buildReplyPreview(request.message),
        };
      }
      return agentService.execute(request, sessionId, signal);
    },
    notify: async (request, text) => {
      await notifyText(request, text, 'status');
    },
  });

  const runtimeNotifier = new YZJRuntimeNotifier(
    {
      send: async (target, text) => {
        await deliverText(target, text, 'status');
      },
    },
    taskManager,
    approvalStore
  );

  let agentService: ChannelAgentService | null = null;
  if (!options.dryRun) {
    const adapter = createAdapter(config);
    const creds = await loadCredentials();
    const devApp = await getDevAppIdentity();
    const customAgents = await loadCustomAgents();

    agentService = new ChannelAgentService(
      {
        createSession: async (sessionId) => {
          const binding = bindingStore.get(sessionId);
          const cwd = binding?.cwd ?? process.cwd();
          const skillState = ensureSessionSkillCatalog(sessionSkillCatalogs, sessionId, cwd);
          const skills = await skillState.catalog.reload();
          const systemPrompt = await buildSystemPrompt({
            enterpriseId: creds?.enterpriseId ?? null,
            devApp,
            cwd,
            budget: config.contextBudget,
            skills,
            agents: customAgents.map((agent) => ({
              name: agent.name,
              model: agent.model,
              allowedTools: agent.allowedTools,
            })),
          });

          const hooks = createRuntimeHooks();
          let currentTurnId = 'turn_pending';
          const detachTurnTracker = hooks.on('turn_started', (event) => {
            currentTurnId = event.turnId;
          });
          const detachNotifier = runtimeNotifier.bind(sessionId, hooks);
          const permissionManager = new PermissionManager({ mode: 'default' });
          const skillTool = createSkillTool(skillState.catalog);
          const tools = buildBoundToolList(skillTool, cwd);
          const registry = new ToolRegistry(
            {
              permissionManager,
              dryRun: false,
              onPrompt: async (toolName, input) => {
                const task = taskManager.getActiveTask(sessionId);
                const approval = approvalStore.create({
                  sessionId,
                  turnId: currentTurnId,
                  taskId: task?.taskId,
                  toolName,
                  summary: buildApprovalSummary(toolName, input),
                });
                hooks.emit({
                  type: 'approval_required',
                  sessionId,
                  turnId: currentTurnId,
                  approvalId: approval.approvalId,
                });
                const decision = await approvalStore.waitForDecision(approval.approvalId);
                taskManager.resumeFromApproval(approval, decision ?? 'expired');
                return decision === 'approve';
              },
            },
            tools
          );

          return {
            agent: new Agent(adapter, registry, systemPrompt, { hooks }),
            dispose: () => {
              detachTurnTracker();
              detachNotifier();
            },
          };
        },
      },
      {
        reply: async (request, text, context) => {
          const task = taskManager.getActiveTask(context.sessionId);
          await deliverText(
            request.replyTarget,
            formatFinalReply(task?.taskId, text),
            'result'
          );
        },
        onError: async (request, error, context) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const task = taskManager.getActiveTask(context.sessionId);
          console.error(`[yzj] agent run failed: ${errorMessage}`);
          await deliverText(
            request.replyTarget,
            task
              ? `任务 ${task.taskId} 执行失败\n错误：${errorMessage}\n发送 /status ${task.taskId} 查看详情`
              : `抱歉，处理你的消息时出错：${errorMessage}`,
            'result'
          );
        },
      }
    );
  }

  const processInboundMessage = async (
    rawMessage: Parameters<typeof parseYZJMessage>[0],
    source: 'webhook' | 'websocket'
  ) => {
    if (!dedupeStore.markSeen(rawMessage.msgId)) {
      console.info(`[yzj] duplicate inbound dropped from ${source}: ${rawMessage.msgId}`);
      return;
    }

    const request = parseYZJMessage(rawMessage);
    const inboundStartedAt = Date.now();
    const result = await handleChannelRequest(request, sessionStore, {
      execute: async (input, sessionId) => {
        console.info(
          `[yzj] accepted ${source} message msgId=${rawMessage.msgId} session=${sessionId} from=${rawMessage.operatorOpenid} chars=${input.message.length}`,
        );
        const command = parseYZJCommand(input.message);
        const binding = bindingStore.get(sessionId) ?? null;
        const skillState = ensureSessionSkillCatalog(sessionSkillCatalogs, sessionId, binding?.cwd ?? process.cwd());
        const skills = await skillState.catalog.reload();

        if (command.kind === 'help') {
          await notifyText(input, formatYZJHelp(skills.map((skill) => skill.name)), 'status');
          return;
        }

        if (command.kind === 'status') {
          const task = command.taskId
            ? resolveSessionTask(taskManager, sessionId, command.taskId)
            : taskManager.getLatestTask(sessionId);
          await notifyText(input, task ? taskManager.formatStatus(task) : buildMissingTaskMessage(command.taskId), 'status');
          return;
        }

        if (command.kind === 'cancel') {
          const task = resolveSessionTask(taskManager, sessionId, command.taskId);
          if (!task) {
            await notifyText(input, buildMissingTaskMessage(command.taskId), 'status');
            return;
          }
          const cancellation = taskManager.cancelTask(command.taskId);
          await notifyText(input, cancellation.message, 'status');
          return;
        }

        if (command.kind === 'approve' || command.kind === 'deny') {
          await handleApprovalCommand(input, sessionId, command.approvalId, command.kind, approvalStore, taskManager, notifyText);
          return;
        }

        if (command.kind === 'bind') {
          if (hasPendingTasks(taskManager, sessionId)) {
            await notifyText(input, '当前会话还有未完成任务，完成后再切换工作区', 'status');
            return;
          }

          if (command.clear) {
            const cleared = bindingStore.clear(sessionId);
            agentService?.resetSession(sessionId);
            sessionSkillCatalogs.delete(sessionId);
            await notifyText(
              input,
              cleared ? '已清除当前会话的工作区绑定，后续任务将使用默认目录' : '当前会话还没有绑定工作区',
              'status'
            );
            return;
          }

          try {
            const nextBinding = await bindingStore.bind({
              sessionId,
              chatId: input.sessionKey.chatId,
              userId: input.sessionKey.userId,
              cwd: command.cwd!,
            });
            agentService?.resetSession(sessionId);
            sessionSkillCatalogs.delete(sessionId);
            await notifyText(input, formatBindingMessage(nextBinding), 'status');
          } catch (error) {
            await notifyText(input, `绑定失败：${error instanceof Error ? error.message : String(error)}`, 'status');
          }
          return;
        }

        if (command.kind === 'skill') {
          const skill = skillState.catalog.get(command.skillName);
          if (!skill) {
            await notifyText(
              input,
              `找不到 skill "${command.skillName}"。可用 skills：${skills.map((item) => '/' + item.name).join(', ') || '（无）'}`,
              'status'
            );
            return;
          }

          const skillRequest = buildSkillRequest(input, skill.name, formatSkillPayload(skill), command.args);
          await taskManager.createAndStart(skillRequest, sessionId, {
            binding,
          });
          return;
        }

        await taskManager.createAndStart(input, sessionId, {
          binding,
        });
      },
    });
    console.info(`[yzj] session ${result.sessionId} handled ${source} message ${rawMessage.msgId} totalMs=${Date.now() - inboundStartedAt}`);
  };

  const shutdown = new AbortController();
  const onSignal = () => {
    shutdown.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let server: ReturnType<typeof createServer> | null = null;
  if (enableWebhook) {
    const webhookHandler = createYZJWebhookHandler({
      path: yzjConfig.webhookPath,
      secret: yzjConfig.secret,
      logger: console,
      onMessage: (message) => processInboundMessage(message, 'webhook'),
    });

    server = createServer((req, res) => {
      void webhookHandler(req, res).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end('Not Found');
        }
      }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[yzj] webhook error: ${errorMessage}`);
        res.statusCode = 500;
        res.end('Internal Server Error');
      });
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(yzjConfig.webhookPort, () => {
        server!.off('error', reject);
        console.info(`[yzj] webhook listening on http://localhost:${yzjConfig.webhookPort}${yzjConfig.webhookPath}`);
        resolve();
      });
    });
  }

  let websocketClient: YZJWebSocketClient | null = null;
  if (yzjConfig.inboundMode === 'websocket') {
    const websocketUrl = deriveYZJWebSocketUrl(yzjConfig.sendMsgUrl);
    websocketClient = new YZJWebSocketClient({
      url: websocketUrl,
      logger: console,
      onReady: () => {
        console.info('[yzj] websocket ready');
      },
      onDegraded: (message) => {
        console.warn(`[yzj] websocket degraded: ${message}`);
      },
      onMessage: (message) => processInboundMessage(message, 'websocket'),
    });
    websocketClient.start();
  }

  console.info(`[yzj] gateway started (mode=${yzjConfig.inboundMode}, webhook=${enableWebhook ? 'on' : 'off'})`);

  try {
    await new Promise<void>((resolve) => {
      shutdown.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  } finally {
    websocketClient?.stop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

async function updateYZJConfig(
  update: (current: NonNullable<YZJChannelConfig | undefined>) => YZJChannelConfig
): Promise<void> {
  const config = await loadConfig();
  const current = config.channels?.yzj ?? {};
  config.channels = config.channels ?? {};
  config.channels.yzj = update(current);
  await saveConfig(config);
}

function ensureSessionSkillCatalog(
  sessionSkillCatalogs: Map<string, SessionSkillCatalogState>,
  sessionId: string,
  cwd: string
): SessionSkillCatalogState {
  const existing = sessionSkillCatalogs.get(sessionId);
  if (existing && existing.cwd === cwd) {
    return existing;
  }

  const created: SessionSkillCatalogState = {
    cwd,
    catalog: createSkillCatalog(undefined, cwd),
  };
  sessionSkillCatalogs.set(sessionId, created);
  return created;
}

async function handleApprovalCommand(
  request: ChannelRequest,
  sessionId: string,
  approvalId: string,
  action: ApprovalAction,
  approvalStore: InMemoryApprovalStore,
  taskManager: TaskManager,
  notifyText: (request: ChannelRequest, text: string, kind?: 'status' | 'approval' | 'result') => Promise<void>
): Promise<void> {
  const approval = approvalStore.get(approvalId);
  if (!approval || approval.sessionId !== sessionId) {
    await notifyText(request, `未找到当前会话下的审批单 ${approvalId}`, 'status');
    return;
  }

  const resolved = approvalStore.resolve(approvalId, action);
  if (!resolved) {
    await notifyText(request, `审批单 ${approvalId} 已失效`, 'status');
    return;
  }

  taskManager.resumeFromApproval(approval, resolved);
  await notifyText(
    request,
    `已${resolved === 'approve' ? '批准' : '拒绝'} ${approvalId}${approval.taskId ? `，任务 ${approval.taskId} 将继续执行` : ''}`,
    'status'
  );
}

function buildSkillRequest(
  request: ChannelRequest,
  skillName: string,
  skillPayload: string,
  args?: string
): ChannelRequest {
  return {
    ...request,
    message: args?.trim()
      ? `执行 skill "${skillName}"，用户补充说明：${args.trim()}\n\n${skillPayload}`
      : `执行 skill：\n\n${skillPayload}`,
  };
}

function resolveSessionTask(taskManager: TaskManager, sessionId: string, taskId: string) {
  const task = taskManager.getTask(taskId);
  if (!task || task.sessionId !== sessionId) {
    return undefined;
  }
  return task;
}

function hasPendingTasks(taskManager: TaskManager, sessionId: string): boolean {
  return taskManager.listTasks(sessionId).some((task) =>
    task.status === 'queued' || task.status === 'running' || task.status === 'waiting_approval'
  );
}

function buildMissingTaskMessage(taskId?: string): string {
  if (taskId) {
    return `未找到当前会话下的任务 ${taskId}`;
  }
  return '当前会话下暂无任务';
}

function formatYZJHelp(skillNames: string[]): string {
  const lines = [
    '可用命令：',
    '/help',
    '/status [taskId]',
    '/cancel <taskId>',
    '/approve <approvalId>',
    '/deny <approvalId>',
    '/bind <cwd>',
    '/bind clear',
    '/skill <name> [args]',
  ];
  if (skillNames.length > 0) {
    lines.push(`可用 skills：${skillNames.map((name) => `/${name}`).join(', ')}`);
  }
  return lines.join('\n');
}

function formatBindingMessage(binding: SessionBinding): string {
  const lines = [
    '已绑定当前会话工作区',
    `cwd：${binding.cwd}`,
  ];
  if (binding.repoRoot) {
    lines.push(`repo：${binding.repoRoot}`);
  }
  if (binding.branch) {
    lines.push(`branch：${binding.branch}`);
  }
  return lines.join('\n');
}

function buildApprovalSummary(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'bash' && typeof input.command === 'string') {
    return `执行 bash 命令：${truncate(input.command, 120)}`;
  }
  if ((toolName === 'write' || toolName === 'edit') && typeof input.file_path === 'string') {
    return `${toolName} 文件：${truncate(input.file_path, 120)}`;
  }
  return `${toolName} 操作需要确认`;
}

function buildBoundToolList(skillTool: Tool, cwd: string): Tool[] {
  return buildToolList(skillTool, { cwd }).map((tool) => {
    if (tool.definition.name !== 'bash') {
      return tool;
    }
    return {
      ...bashTool,
      execute: async (input) => {
        const payload = {
          ...input,
          workdir: typeof input.workdir === 'string' ? input.workdir : cwd,
        };
        return bashTool.execute(payload);
      },
    };
  });
}

function formatFinalReply(taskId: string | undefined, text: string): string {
  const reply = text.trim();
  if (!taskId || reply.length <= 800) {
    return reply;
  }
  return [
    `任务 ${taskId} 已完成`,
    `摘要：${buildReplyPreview(reply)}`,
    '详细结果：',
    reply,
  ].join('\n\n');
}

function buildReplyPreview(reply: string, maxLength = 160): string {
  if (reply.length <= maxLength) {
    return reply;
  }
  return `${reply.slice(0, maxLength)}...`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
