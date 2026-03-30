const VALID_STATUS = [
    'queued',
    'running',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled',
];
export function createTaskTools(options) {
    const { board, sessionId } = options;
    return [
        {
            permission: 'safe',
            definition: {
                name: 'task_create',
                description: '为当前会话创建一个可追踪任务项',
                inputSchema: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: '任务标题' },
                        details: { type: 'string', description: '任务详情（可选）' },
                        owner: { type: 'string', description: '负责人（可选）' },
                    },
                    required: ['title'],
                },
            },
            async execute(input) {
                const title = typeof input.title === 'string' ? input.title.trim() : '';
                if (!title) {
                    return 'Error: title 不能为空';
                }
                const task = board.create(sessionId, {
                    title,
                    details: typeof input.details === 'string' ? input.details : undefined,
                    owner: typeof input.owner === 'string' ? input.owner : undefined,
                });
                return JSON.stringify(task, null, 2);
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'task_update',
                description: '更新当前会话中的任务状态、详情或进展',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task_id: { type: 'string', description: '任务 ID' },
                        status: { type: 'string', enum: VALID_STATUS, description: '任务状态（可选）' },
                        details: { type: 'string', description: '新的任务详情（可选）' },
                        owner: { type: 'string', description: '新的负责人（可选）' },
                        note: { type: 'string', description: '新的进展记录（可选）' },
                    },
                    required: ['task_id'],
                },
            },
            async execute(input) {
                const taskId = typeof input.task_id === 'string' ? input.task_id : '';
                if (!taskId) {
                    return 'Error: task_id 不能为空';
                }
                const rawStatus = typeof input.status === 'string' ? input.status : undefined;
                if (rawStatus && !VALID_STATUS.includes(rawStatus)) {
                    return `Error: 非法状态: ${rawStatus}`;
                }
                const updated = board.update(sessionId, taskId, {
                    status: rawStatus,
                    details: typeof input.details === 'string' ? input.details : undefined,
                    owner: typeof input.owner === 'string' ? input.owner : undefined,
                    note: typeof input.note === 'string' ? input.note : undefined,
                });
                if (!updated) {
                    return `Error: 未找到任务 ${taskId}`;
                }
                return JSON.stringify(updated, null, 2);
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'task_list',
                description: '列出当前会话中的任务',
                inputSchema: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', enum: VALID_STATUS, description: '按状态过滤（可选）' },
                        limit: { type: 'number', description: '返回数量上限（可选）' },
                    },
                    required: [],
                },
            },
            async execute(input) {
                const rawStatus = typeof input.status === 'string' ? input.status : undefined;
                const tasks = board.list(sessionId, {
                    status: rawStatus,
                    limit: typeof input.limit === 'number' ? input.limit : undefined,
                });
                return JSON.stringify(tasks, null, 2);
            },
        },
        {
            permission: 'safe',
            definition: {
                name: 'task_get',
                description: '查看当前会话中的某个任务详情',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task_id: { type: 'string', description: '任务 ID' },
                    },
                    required: ['task_id'],
                },
            },
            async execute(input) {
                const taskId = typeof input.task_id === 'string' ? input.task_id : '';
                if (!taskId) {
                    return 'Error: task_id 不能为空';
                }
                const task = board.get(sessionId, taskId);
                if (!task) {
                    return `Error: 未找到任务 ${taskId}`;
                }
                return JSON.stringify(task, null, 2);
            },
        },
    ];
}
