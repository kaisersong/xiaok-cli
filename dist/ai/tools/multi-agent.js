export const MULTI_AGENT_TOOL_NAMES = [
    'spawn_agent',
    'send_message',
    'followup_task',
    'wait_agent',
    'list_agents',
    'interrupt_agent',
    'close_agent',
];
export const CHILD_COMMUNICATION_TOOL_NAMES = new Set([
    'send_message',
    'wait_agent',
    'list_agents',
]);
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const MIN_WAIT_TIMEOUT_MS = 10_000;
const MAX_WAIT_TIMEOUT_MS = 3_600_000;
export function createMultiAgentTools(options) {
    return [
        createSpawnAgentTool(options),
        createSendMessageTool(options),
        createFollowupTaskTool(options),
        createWaitAgentTool(options),
        createListAgentsTool(options),
        createInterruptAgentTool(options),
        createCloseAgentTool(options),
    ];
}
function createSpawnAgentTool(options) {
    const configuredAgents = options.agents.map((agent) => agent.name).join(', ') || '(none)';
    return {
        permission: 'safe',
        definition: {
            name: 'spawn_agent',
            description: `启动一个可寻址、可续轮的后台 Subagent，并立即返回 Agent ID。可用预定义 Agent：${configuredAgents}。初步定位后，若任务已有多个独立审查方向且你仍需整合，应先分派有明确边界的部分，再深入其他分支；无需用户点名子 Agent。不要用它替代同一 Agent 的 followup_task。Follow the CLI delegation policy when present: clear independent work can be delegated without the user naming an agent; simple or dependent work stays with the caller. Honor user opt-out and ask-first instructions. Never spawn alongside an unanswered question about this delegation.`,
            inputSchema: {
                type: 'object',
                properties: {
                    task_name: {
                        type: 'string',
                        description: '稳定任务名，只能使用小写字母、数字和下划线。',
                    },
                    message: { type: 'string', description: '给新 Agent 的首轮任务。' },
                    agent: { type: 'string', description: '可选的预定义 Agent 名。' },
                    description: { type: 'string', description: '内联 Agent 的简短职责。' },
                    model: { type: 'string', description: '可选模型覆盖。' },
                    modelCapability: { type: 'string', description: '可选模型能力路由；与 model 互斥。' },
                    tools: { type: 'array', items: { type: 'string' }, description: '内联 Agent 的工具允许集；省略或空数组使用默认全套工具。非空时额外保留 send_message/wait_agent/list_agents，spawn_agent/followup_task/interrupt_agent/close_agent 需显式列入；深度上限不授予工具权限。' },
                    isolation: { type: 'string', enum: ['none', 'worktree'] },
                    fork_context: { type: 'boolean', description: '是否继承当前主会话上下文，默认 true。' },
                },
                required: ['task_name', 'message'],
                additionalProperties: false,
            },
        },
        async execute(input, context) {
            const invocation = input;
            const agentDef = resolveCollaborativeAgentDef(options.agents, invocation);
            const result = await options.coordinator.spawn({
                requestSource: 'agent',
                callerId: options.callerId,
                taskName: invocation.task_name,
                message: invocation.message,
                createSession: (identity, signal) => options.createSession({
                    agentDef,
                    taskDescription: invocation.description,
                    identity,
                    signal,
                    forkContext: invocation.fork_context === false ? undefined : context,
                }),
            });
            return JSON.stringify(result);
        },
    };
}
function createSendMessageTool(options) {
    return simpleMutationTool({
        name: 'send_message',
        description: '向同一 Agent 树中的目标发送消息。此操作不触发新 turn；运行中的子 Agent 在下一完整模型边界接收，不能强行打断工具/网络调用。只能用于进度、问题或上下文传递，追加执行任务请用 followup_task。',
        properties: {
            target: { type: 'string', description: 'Agent ID、canonical task path，或 main。' },
            message: { type: 'string', description: '消息正文。' },
        },
        required: ['target', 'message'],
        execute: (input) => options.coordinator.sendMessage({
            requestSource: 'agent',
            callerId: options.callerId,
            target: String(input.target),
            message: String(input.message),
        }),
    });
}
function createFollowupTaskTool(options) {
    return simpleMutationTool({
        name: 'followup_task',
        description: '只能向自己的严格后代 Subagent 追加一轮串行任务；保留该 Agent 的历史，运行中会排队。严禁向自身、祖先、兄弟或其他分支追加任务，严禁用它启动 main turn。',
        properties: {
            target: { type: 'string', description: '自己的严格后代 Subagent ID 或 canonical task path。' },
            message: { type: 'string', description: '后续任务。' },
        },
        required: ['target', 'message'],
        execute: (input) => options.coordinator.followupTask({
            requestSource: 'agent',
            callerId: options.callerId,
            target: String(input.target),
            message: String(input.message),
        }),
    });
}
function createWaitAgentTool(options) {
    return {
        permission: 'safe',
        definition: {
            name: 'wait_agent',
            description: '等待目标 Agent 的消息或任务终态，并消费来自目标的消息。任一目标已终结会立即返回；后续只能等待仍 pending/running 的目标，严禁对 failed/closed 重复等待。timedOut 仅表示本次等待超时，不代表任务失败；用 phase/lastActivityAt 区分长思考与无响应。执行预算耗尽会返回 failed 和明确 error，此时报告失败，不自动重试。',
            inputSchema: {
                type: 'object',
                properties: {
                    targets: { type: 'array', items: { type: 'string' }, description: '一个或多个 Agent target。' },
                    timeout_ms: { type: 'number', description: '等待毫秒数，范围 10000–3600000。' },
                },
                required: ['targets'],
                additionalProperties: false,
            },
        },
        async execute(input, context) {
            const rawTargets = input.targets;
            if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
                throw new Error('targets must be a non-empty array');
            }
            const rawTimeout = typeof input.timeout_ms === 'number'
                ? input.timeout_ms
                : DEFAULT_WAIT_TIMEOUT_MS;
            const timeoutMs = Math.min(MAX_WAIT_TIMEOUT_MS, Math.max(MIN_WAIT_TIMEOUT_MS, rawTimeout));
            return JSON.stringify(await options.coordinator.waitForUpdate({
                requestSource: 'agent',
                callerId: options.callerId,
                targets: rawTargets.map(String),
                timeoutMs,
                signal: context?.signal,
            }));
        },
    };
}
function createListAgentsTool(options) {
    return {
        permission: 'safe',
        definition: {
            name: 'list_agents',
            description: '列出当前 root session 树中的 Agent、canonical path、状态、未读消息数，以及 turn、phase、currentTool、startedAt、lastActivityAt、executionActive、runtimeResident、resourcesReleased 和 cleanupError。runtimeResident=false 表示空闲运行资源已回收，可按容量恢复续轮；resourcesReleased 表示完整关闭，工作目录按策略保留或删除。watchdog 超时 Agent 自动回收并保留 failed 原因，不能恢复。不能仅凭 running 推断死锁；cleanupError 表示资源清理失败。',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        async execute() {
            return JSON.stringify(options.coordinator.listAgents({
                requestSource: 'agent',
                callerId: options.callerId,
            }));
        },
    };
}
function createInterruptAgentTool(options) {
    return simpleMutationTool({
        name: 'interrupt_agent',
        description: '请求中断目标 Agent 的 pending 创建或当前 turn，并清空此前排队的 followup。interrupted:true 表示接受取消请求，executionActive:false 才说明执行已退出；没有待执行任务时返回 false 且保持状态。执行结算后才能用 followup_task 追加新任务。只能操作 caller 的严格后代；严禁中断 main、自己、祖先或兄弟 Agent。',
        properties: { target: { type: 'string', description: '后代 Agent ID 或 canonical task path。' } },
        required: ['target'],
        execute: (input) => options.coordinator.interruptAgent({
            requestSource: 'agent',
            callerId: options.callerId,
            target: String(input.target),
        }),
    });
}
function createCloseAgentTool(options) {
    return simpleMutationTool({
        name: 'close_agent',
        description: '关闭目标 Agent 及其后代；closed:true 表示控制面已关闭，底层任务结算后才清理资源。返回 resourcesReleased 表示整棵子树是否释放，cleanupPending 表示清理是否仍待结算，agents[].cleanupError 公开清理失败。只有 resourcesReleased:true 才可报告资源已释放，底层未退出时保留 resident slot。只能操作 caller 的严格后代；严禁关闭 main、自己、祖先或兄弟 Agent。关闭后不可恢复。',
        properties: { target: { type: 'string', description: '后代 Agent ID 或 canonical task path。' } },
        required: ['target'],
        execute: (input) => options.coordinator.closeAgent({
            requestSource: 'agent',
            callerId: options.callerId,
            target: String(input.target),
        }),
    });
}
function simpleMutationTool(options) {
    return {
        permission: 'safe',
        definition: {
            name: options.name,
            description: options.description,
            inputSchema: {
                type: 'object',
                properties: options.properties,
                required: options.required,
                additionalProperties: false,
            },
        },
        async execute(input) {
            return JSON.stringify(await options.execute(input));
        },
    };
}
function resolveCollaborativeAgentDef(agents, invocation) {
    if (invocation.model && invocation.modelCapability) {
        throw new Error('model and modelCapability are mutually exclusive');
    }
    if (invocation.agent) {
        const configured = agents.find((agent) => agent.name === invocation.agent);
        if (!configured) {
            throw new Error(`unknown agent "${invocation.agent}". Available: ${agents.map((agent) => agent.name).join(', ')}`);
        }
        return {
            ...configured,
            ...(invocation.model ? { model: invocation.model, modelCapability: undefined } : {}),
            ...(invocation.modelCapability ? { model: undefined, modelCapability: invocation.modelCapability } : {}),
        };
    }
    return {
        name: invocation.task_name || 'inline',
        systemPrompt: invocation.description?.trim()
            ? `Your assigned role: ${invocation.description.trim()}`
            : '',
        allowedTools: invocation.tools?.length ? [...invocation.tools] : undefined,
        model: invocation.model,
        modelCapability: invocation.modelCapability,
        maxIterations: 50,
        isolation: invocation.isolation === 'worktree' ? 'worktree' : undefined,
        cleanup: 'keep',
        source: 'project',
    };
}
