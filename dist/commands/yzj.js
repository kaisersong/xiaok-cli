import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig, saveConfig } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getDevAppIdentity } from '../auth/identity.js';
import { createAdapter } from '../ai/models.js';
import { buildSystemPrompt } from '../ai/context/yzj-context.js';
import { Agent } from '../ai/agent.js';
import { PermissionManager } from '../ai/permissions/manager.js';
import { createSkillCatalog } from '../ai/skills/loader.js';
import { createSkillTool, formatSkillPayload } from '../ai/skills/tool.js';
import { createRuntimeHooks } from '../runtime/hooks.js';
import { ChannelAgentService } from '../channels/agent-service.js';
import { FileApprovalStore } from '../channels/approval-store.js';
import { parseYZJCommand } from '../channels/command-parser.js';
import { FileChannelSessionStore } from '../channels/session-store.js';
import { FileSessionBindingStore } from '../channels/session-binding-store.js';
import { TaskManager } from '../channels/task-manager.js';
import { FileTaskStore } from '../channels/task-store.js';
import { FileReplyTargetStore } from '../channels/reply-target-store.js';
import { formatSessionRuntimeSnapshot } from '../channels/session-runtime-snapshot.js';
import { handleChannelRequest } from '../channels/worker.js';
import { FileYZJInboundDedupeStore } from '../channels/yzj-dedupe-store.js';
import { YZJRuntimeNotifier } from '../channels/yzj-runtime-notifier.js';
import { createYZJWebhookHandler } from '../channels/yzj-webhook.js';
import { YZJWebSocketClient } from '../channels/yzj-websocket-client.js';
import { YZJTransport } from '../channels/yzj-transport.js';
import { parseYZJMessage, resolveYZJConfig } from '../channels/yzj.js';
import { deriveYZJWebSocketUrl } from '../channels/yzj-ws-url.js';
import { createPlatformRuntimeContext } from '../platform/runtime/context.js';
import { FileCapabilityHealthStore } from '../platform/runtime/health-store.js';
import { createPlatformRegistryFactory } from '../platform/runtime/registry-factory.js';
function buildOverrides(options) {
    return {
        sendMsgUrl: options.sendMsgUrl,
        inboundMode: options.inboundMode,
        webhookPath: options.webhookPath,
        webhookPort: options.webhookPort ? Number(options.webhookPort) : undefined,
        secret: options.secret,
    };
}
export function registerYZJCommands(program) {
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
        .action(async (url) => {
        await updateYZJConfig((current) => ({ ...current, sendMsgUrl: url }));
        console.log('已设置 channels.yzj.sendMsgUrl');
    });
    yzjConfigCmd
        .command('set-inbound-mode <mode>')
        .description('设置 YZJ 入站模式（webhook / websocket）')
        .action(async (mode) => {
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
        .action(async (path) => {
        await updateYZJConfig((current) => ({ ...current, webhookPath: path }));
        console.log(`已设置 channels.yzj.webhookPath = ${path}`);
    });
    yzjConfigCmd
        .command('set-webhook-port <port>')
        .description('设置 YZJ webhook 监听端口')
        .action(async (port) => {
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
        .action(async (secret) => {
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
    serve.action(async (...args) => {
        const sendMsgUrl = typeof args[0] === 'string' ? args[0] : undefined;
        const command = args.find((arg) => typeof arg?.opts === 'function');
        const options = command
            ? command.opts()
            : (args.find((arg) => Boolean(arg) && typeof arg === 'object') ?? {});
        await runYZJServe({
            ...options,
            sendMsgUrl: options.sendMsgUrl ?? sendMsgUrl,
        });
    });
}
async function runYZJServe(options) {
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
    const stateDir = join(homedir(), '.xiaok', 'state', 'yzj');
    const sessionStore = new FileChannelSessionStore(join(stateDir, 'sessions.json'));
    const dedupeStore = new FileYZJInboundDedupeStore(join(stateDir, 'inbound-dedupe.json'));
    const approvalStore = new FileApprovalStore(join(stateDir, 'approvals.json'));
    const bindingStore = new FileSessionBindingStore(join(stateDir, 'bindings.json'));
    const sessionSkillCatalogs = new Map();
    const latestReplyTargets = new FileReplyTargetStore(join(stateDir, 'reply-targets.json'));
    const deliverText = async (target, text, kind = 'result') => {
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
    const notifyText = async (request, text, kind = 'result') => {
        await deliverText(request.replyTarget, text, kind);
    };
    const taskManager = new TaskManager({
        store: new FileTaskStore(join(stateDir, 'tasks.json')),
        execute: async ({ request, sessionId, signal }) => {
            console.info(`[yzj] task execute session=${sessionId} chars=${request.message.length} aborted=${signal.aborted ? 'yes' : 'no'}`);
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
    const runtimeNotifier = new YZJRuntimeNotifier({
        send: async (target, text) => {
            await deliverText(target, text, 'status');
        },
    }, taskManager, approvalStore);
    expireRecoveredApprovals(approvalStore, taskManager);
    let agentService = null;
    if (!options.dryRun) {
        const adapter = createAdapter(config);
        const creds = await loadCredentials();
        const devApp = await getDevAppIdentity();
        agentService = new ChannelAgentService({
            createSession: async (sessionId) => {
                const binding = bindingStore.get(sessionId);
                const cwd = binding?.cwd ?? process.cwd();
                const skillState = await ensureSessionSkillCatalog(sessionSkillCatalogs, sessionId, cwd);
                const skills = await skillState.catalog.reload();
                const customAgents = skillState.platform.customAgents;
                const systemPrompt = await buildSystemPrompt({
                    enterpriseId: creds?.enterpriseId ?? null,
                    devApp,
                    cwd,
                    budget: config.contextBudget,
                    skills,
                    pluginCommands: skillState.platform.pluginRuntime.commandDeclarations,
                    lspDiagnostics: skillState.platform.lspManager.getSummary(),
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
                const registryFactory = createPlatformRegistryFactory({
                    platform: skillState.platform,
                    source: 'yzj',
                    sessionId,
                    adapter: () => adapter,
                    skillTool,
                    workflowTools: [],
                    dryRun: false,
                    permissionManager,
                    getCurrentTaskId: () => taskManager.getActiveTask(sessionId)?.taskId,
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
                    buildSystemPrompt: async (promptCwd) => buildSystemPrompt({
                        enterpriseId: creds?.enterpriseId ?? null,
                        devApp,
                        cwd: promptCwd,
                        budget: config.contextBudget,
                        skills,
                        pluginCommands: skillState.platform.pluginRuntime.commandDeclarations,
                        lspDiagnostics: skillState.platform.lspManager.getSummary(),
                        agents: customAgents.map((agent) => ({
                            name: agent.name,
                            model: agent.model,
                            allowedTools: agent.allowedTools,
                        })),
                    }),
                    notifyBackgroundJob: async (job) => {
                        const replyTarget = latestReplyTargets.get(sessionId);
                        if (!replyTarget) {
                            return;
                        }
                        await deliverText(replyTarget, `后台任务 ${job.jobId} ${job.status}${job.resultSummary ? `：${job.resultSummary}` : ''}`, 'status');
                    },
                });
                const registry = registryFactory.createRegistry(cwd);
                return {
                    agent: new Agent(adapter, registry, systemPrompt, { hooks }),
                    dispose: () => {
                        detachTurnTracker();
                        detachNotifier();
                    },
                };
            },
        }, {
            reply: async (request, text, context) => {
                const task = taskManager.getActiveTask(context.sessionId);
                await deliverText(request.replyTarget, formatFinalReply(task?.taskId, text), 'result');
            },
            onError: async (request, error, context) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const task = taskManager.getActiveTask(context.sessionId);
                console.error(`[yzj] agent run failed: ${errorMessage}`);
                await deliverText(request.replyTarget, task
                    ? `任务 ${task.taskId} 执行失败\n错误：${errorMessage}\n发送 /status ${task.taskId} 查看详情`
                    : `抱歉，处理你的消息时出错：${errorMessage}`, 'result');
            },
        });
    }
    const processInboundMessage = async (rawMessage, source) => {
        if (!dedupeStore.markSeen(rawMessage.msgId)) {
            console.info(`[yzj] duplicate inbound dropped from ${source}: ${rawMessage.msgId}`);
            return;
        }
        const request = parseYZJMessage(rawMessage);
        const inboundStartedAt = Date.now();
        const result = await handleChannelRequest(request, sessionStore, {
            execute: async (input, sessionId) => {
                latestReplyTargets.set(sessionId, input.replyTarget);
                console.info(`[yzj] accepted ${source} message msgId=${rawMessage.msgId} session=${sessionId} from=${rawMessage.operatorOpenid} chars=${input.message.length}`);
                const command = parseYZJCommand(input.message);
                const binding = bindingStore.get(sessionId) ?? null;
                const skillState = await ensureSessionSkillCatalog(sessionSkillCatalogs, sessionId, binding?.cwd ?? process.cwd());
                const skills = await skillState.catalog.reload();
                if (command.kind === 'help') {
                    await notifyText(input, formatYZJHelp(skills.map((skill) => skill.name)), 'status');
                    return;
                }
                if (command.kind === 'status') {
                    const task = command.taskId
                        ? resolveSessionTask(taskManager, sessionId, command.taskId)
                        : taskManager.getPreferredStatusTask(sessionId);
                    await notifyText(input, formatSessionRuntimeSnapshot({
                        sessionId,
                        binding,
                        taskStatus: task ? taskManager.formatStatus(task) : buildMissingTaskMessage(command.taskId),
                        backgroundJobs: formatBackgroundJobStatus(skillState.platform, sessionId, task?.taskId),
                        approvals: approvalStore
                            .listPending()
                            .filter((approval) => approval.sessionId === sessionId)
                            .map((approval) => ({
                            approvalId: approval.approvalId,
                            summary: approval.summary,
                        })),
                        capabilityHealth: formatCapabilityHealthStatus(skillState.platform, binding?.cwd ?? skillState.cwd),
                    }), 'status');
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
                        disposeSessionSkillCatalog(sessionSkillCatalogs, sessionId);
                        latestReplyTargets.delete(sessionId);
                        await notifyText(input, cleared ? '已清除当前会话的工作区绑定，后续任务将使用默认目录' : '当前会话还没有绑定工作区', 'status');
                        return;
                    }
                    try {
                        const nextBinding = await bindingStore.bind({
                            sessionId,
                            chatId: input.sessionKey.chatId,
                            userId: input.sessionKey.userId,
                            cwd: command.cwd,
                        });
                        agentService?.resetSession(sessionId);
                        disposeSessionSkillCatalog(sessionSkillCatalogs, sessionId);
                        await notifyText(input, formatBindingMessage(nextBinding), 'status');
                    }
                    catch (error) {
                        await notifyText(input, `绑定失败：${error instanceof Error ? error.message : String(error)}`, 'status');
                    }
                    return;
                }
                if (command.kind === 'skill') {
                    const skill = skillState.catalog.get(command.skillName);
                    if (!skill) {
                        await notifyText(input, `找不到 skill "${command.skillName}"。可用 skills：${skills.map((item) => '/' + item.name).join(', ') || '（无）'}`, 'status');
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
        latestReplyTargets.set(result.sessionId, request.replyTarget);
        console.info(`[yzj] session ${result.sessionId} handled ${source} message ${rawMessage.msgId} totalMs=${Date.now() - inboundStartedAt}`);
    };
    const shutdown = new AbortController();
    const onSignal = () => {
        shutdown.abort();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let server = null;
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
            }).catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[yzj] webhook error: ${errorMessage}`);
                res.statusCode = 500;
                res.end('Internal Server Error');
            });
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(yzjConfig.webhookPort, () => {
                server.off('error', reject);
                console.info(`[yzj] webhook listening on http://localhost:${yzjConfig.webhookPort}${yzjConfig.webhookPath}`);
                resolve();
            });
        });
    }
    let websocketClient = null;
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
        await new Promise((resolve) => {
            shutdown.signal.addEventListener('abort', () => resolve(), { once: true });
        });
    }
    finally {
        agentService?.closeAll();
        await disposeAllSessionSkillCatalogs(sessionSkillCatalogs);
        websocketClient?.stop();
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        }
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}
async function updateYZJConfig(update) {
    const config = await loadConfig();
    const current = config.channels?.yzj ?? {};
    config.channels = config.channels ?? {};
    config.channels.yzj = update(current);
    await saveConfig(config);
}
async function ensureSessionSkillCatalog(sessionSkillCatalogs, sessionId, cwd) {
    const existing = sessionSkillCatalogs.get(sessionId);
    if (existing && existing.cwd === cwd) {
        return existing;
    }
    const platform = await createPlatformRuntimeContext({
        cwd,
        builtinCommands: ['chat', 'doctor', 'init', 'review', 'pr', 'commit', 'settings', 'context', 'yzj'],
    });
    const created = {
        cwd,
        catalog: createSkillCatalog(undefined, cwd, { extraRoots: platform.pluginRuntime.skillRoots }),
        platform,
    };
    sessionSkillCatalogs.set(sessionId, created);
    return created;
}
function disposeSessionSkillCatalog(sessionSkillCatalogs, sessionId) {
    const state = sessionSkillCatalogs.get(sessionId);
    if (!state) {
        return;
    }
    void state.platform.dispose();
    sessionSkillCatalogs.delete(sessionId);
}
async function disposeAllSessionSkillCatalogs(sessionSkillCatalogs) {
    const states = [...sessionSkillCatalogs.values()];
    sessionSkillCatalogs.clear();
    for (const state of states) {
        await state.platform.dispose();
    }
}
async function handleApprovalCommand(request, sessionId, approvalId, action, approvalStore, taskManager, notifyText) {
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
    await notifyText(request, `已${resolved === 'approve' ? '批准' : '拒绝'} ${approvalId}${approval.taskId ? `，任务 ${approval.taskId} 将继续执行` : ''}`, 'status');
}
function buildSkillRequest(request, skillName, skillPayload, args) {
    return {
        ...request,
        message: args?.trim()
            ? `执行 skill "${skillName}"，用户补充说明：${args.trim()}\n\n${skillPayload}`
            : `执行 skill：\n\n${skillPayload}`,
    };
}
function resolveSessionTask(taskManager, sessionId, taskId) {
    const task = taskManager.getTask(taskId);
    if (!task || task.sessionId !== sessionId) {
        return undefined;
    }
    return task;
}
function hasPendingTasks(taskManager, sessionId) {
    return taskManager.listTasks(sessionId).some((task) => task.status === 'queued' || task.status === 'running' || task.status === 'waiting_approval');
}
function buildMissingTaskMessage(taskId) {
    if (taskId) {
        return `未找到当前会话下的任务 ${taskId}`;
    }
    return '当前会话下暂无任务';
}
function formatYZJHelp(skillNames) {
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
function formatBindingMessage(binding) {
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
function formatCapabilityHealthStatus(platform, cwd) {
    const healthStore = new FileCapabilityHealthStore(join(cwd, '.xiaok', 'state', 'capability-health.json'));
    const persisted = healthStore.get(cwd);
    const summary = persisted?.summary ?? platform.health.summary();
    const capabilities = persisted?.capabilities ?? platform.health.capabilities;
    if (!capabilities.some((entry) => entry.status === 'degraded')) {
        return `平台能力状态：正常\n${summary}`;
    }
    return `平台能力状态：降级\n${summary}`;
}
function formatBackgroundJobStatus(platform, sessionId, taskId) {
    const jobs = (taskId
        ? platform.listBackgroundJobs(sessionId).filter((job) => job.taskId === taskId)
        : platform.listBackgroundJobs(sessionId))
        .slice(0, 5);
    return jobs.map((job) => ({
        jobId: job.jobId,
        status: job.status,
        detail: job.resultSummary ?? job.errorMessage ?? job.inputSummary,
    }));
}
function expireRecoveredApprovals(approvalStore, taskManager) {
    for (const approval of approvalStore.listPending()) {
        approvalStore.expire(approval.approvalId);
        taskManager.markApprovalInterrupted(approval, '网关重启后审批已失效，请重新发起任务');
    }
}
function buildApprovalSummary(toolName, input) {
    if (toolName === 'bash' && typeof input.command === 'string') {
        return `执行 bash 命令：${truncate(input.command, 120)}`;
    }
    if ((toolName === 'write' || toolName === 'edit') && typeof input.file_path === 'string') {
        return `${toolName} 文件：${truncate(input.file_path, 120)}`;
    }
    return `${toolName} 操作需要确认`;
}
function formatFinalReply(taskId, text) {
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
function buildReplyPreview(reply, maxLength = 160) {
    if (reply.length <= maxLength) {
        return reply;
    }
    return `${reply.slice(0, maxLength)}...`;
}
function truncate(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...`;
}
