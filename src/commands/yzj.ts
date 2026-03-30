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
import { createSkillCatalog } from '../ai/skills/loader.js';
import { createSkillTool } from '../ai/skills/tool.js';
import { ChannelAgentService } from '../channels/agent-service.js';
import { InMemoryChannelSessionStore } from '../channels/session-store.js';
import { YZJInboundDedupeStore } from '../channels/yzj-dedupe-store.js';
import { createYZJWebhookHandler } from '../channels/yzj-webhook.js';
import { YZJWebSocketClient } from '../channels/yzj-websocket-client.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { parseYZJMessage, resolveYZJConfig } from '../channels/yzj.js';
import { deriveYZJWebSocketUrl } from '../channels/yzj-ws-url.js';
import type { YZJChannelConfig } from '../types.js';
import { handleChannelRequest } from '../channels/worker.js';

interface YZJServeOptions {
  sendMsgUrl?: string;
  inboundMode?: 'webhook' | 'websocket';
  webhookPath?: string;
  webhookPort?: string;
  secret?: string;
  webhook?: boolean;
  dryRun?: boolean;
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

  let agentService: ChannelAgentService | null = null;
  if (!options.dryRun) {
    const adapter = createAdapter(config);
    const creds = await loadCredentials();
    const devApp = await getDevAppIdentity();
    const customAgents = await loadCustomAgents();
    const skillCatalog = createSkillCatalog();
    const skills = await skillCatalog.reload();

    const systemPrompt = await buildSystemPrompt({
      enterpriseId: creds?.enterpriseId ?? null,
      devApp,
      cwd: process.cwd(),
      budget: config.contextBudget,
      skills,
      agents: customAgents.map((agent) => ({
        name: agent.name,
        model: agent.model,
        allowedTools: agent.allowedTools,
      })),
    });

    agentService = new ChannelAgentService(
      {
        createAgent: () => {
          const permissionManager = new PermissionManager({ mode: 'auto' });
          const skillTool = createSkillTool(skillCatalog);
          const tools = buildToolList(skillTool, { cwd: process.cwd() });
          const registry = new ToolRegistry({ permissionManager, dryRun: false }, tools);
          return new Agent(adapter, registry, systemPrompt);
        },
      },
      {
        reply: async (request, text) => {
          await transport.deliver({
            channel: 'yzj',
            target: request.replyTarget,
            text,
            kind: 'result',
          });
        },
        onError: async (request, error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[yzj] agent run failed: ${errorMessage}`);
          await transport.deliver({
            channel: 'yzj',
            target: request.replyTarget,
            text: `抱歉，处理你的消息时出错：${errorMessage}`,
            kind: 'result',
          });
        },
      }
    );
  }

  const processInboundMessage = async (rawMessage: Parameters<typeof parseYZJMessage>[0], source: 'webhook' | 'websocket') => {
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
        if (!agentService) {
          console.info(`[yzj][dry-run] inbound text: ${input.message}`);
          return;
        }
        const execution = await agentService.execute(input, sessionId);
        if (execution.ok) {
          console.info(
            `[yzj] completed msgId=${rawMessage.msgId} session=${sessionId} modelMs=${execution.generationMs} outboundMs=${execution.deliveryMs} totalMs=${Date.now() - inboundStartedAt} replyChars=${execution.replyLength}`,
          );
        } else {
          console.error(
            `[yzj] failed msgId=${rawMessage.msgId} session=${sessionId} modelMs=${execution.generationMs} outboundMs=${execution.deliveryMs} totalMs=${Date.now() - inboundStartedAt} error=${execution.errorMessage ?? 'unknown error'}`,
          );
        }
      },
    });
    console.info(`[yzj] session ${result.sessionId} handled ${source} message ${rawMessage.msgId}`);
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
